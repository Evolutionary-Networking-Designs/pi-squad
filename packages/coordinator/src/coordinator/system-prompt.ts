/**
 * @module coordinator/system-prompt
 * Loads and builds the Squad coordinator system prompt.
 */

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import type { Coordinator } from "./coordinator.js";
import { sanitize } from "../context/ingestion/sanitizer.js";

const SQUAD_AGENT_MD = fileURLToPath(
  new URL("../../squad/.github/agents/squad.agent.md", import.meta.url),
);
const SQUAD_PACKAGE_JSON = fileURLToPath(
  new URL("../../squad/package.json", import.meta.url),
);
const TEAM_MD_FILENAME = "team.md";
const ROUTING_MD_FILENAME = "routing.md";
const DECISIONS_MD_FILENAME = "decisions.md";
const SECTION_SEPARATOR = "\n\n---\n# Squad Coordinator\n\n";

const PROMPTS_DIR = fileURLToPath(new URL("../../prompts", import.meta.url));

export const TWO_TIER_DESCRIPTION = `## Execution Architecture

Team personas (Motoko, Batou, etc.) are identity + expertise overlays. When routing work to a persona, the system spawns the appropriate pi-subagents built-in (worker, planner, reviewer, etc.) with that persona's charter as context.

Available standalone execution primitives (no persona required):
- **scout**: local-only file/code reconnaissance
- **researcher**: external evidence acquisition
- **context-builder**: handoff packaging (coordinator-internal)`;

export const MAX_PROMPT_CHARS = 120_000;

export class SquadMissingError extends Error {
  constructor(filePath: string) {
    super(`Required Squad coordinator prompt missing: ${filePath}`);
    this.name = "SquadMissingError";
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readRequiredFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      throw new SquadMissingError(filePath);
    }
    throw error;
  }
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }
}

/** Rough token estimate: 1 token ≈ 4 chars for English text. */
export function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / 4);
}

function validateTeamMd(content: string): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  if (!content.includes("## Members")) {
    warnings.push("team.md is missing ## Members section — label routing may break");
  }
  if (!content.includes("|")) {
    warnings.push("team.md has no table rows — team may be empty");
  }
  return { valid: warnings.length === 0, warnings };
}


function formatSection(title: string, content: string): string {
  return `---\n## ${title}\n${content.trim()}`;
}

export async function buildWorkflowSection(): Promise<string> {
  try {
    const files = await readdir(PROMPTS_DIR);
    const mdFiles = files.filter((f) => f.endsWith(".md")).sort();
    const entries: string[] = [];

    for (const file of mdFiles) {
      const content = await readFile(join(PROMPTS_DIR, file), "utf8").catch(() => "");
      const match = /^description:\s*(.+)$/m.exec(content);
      const description = match ? match[1].trim() : "(no description)";
      const name = file.replace(/\.md$/, "");
      entries.push(`- **${name}**: ${description}`);
    }

    if (entries.length === 0) return "";

    return `## Workflow Shortcuts\n\nOrchestration patterns available via \`subagent()\`:\n\n${entries.join("\n")}`;
  } catch {
    return "";
  }
}

function assemblePrompt(
  squadAgent: string,
  team: string,
  routing: string | null,
  decisions: string | null,
): string {
  const sections = [
    squadAgent.trim(),
    formatSection("Current Team", team),
    routing ? formatSection("Routing Rules", routing) : null,
    decisions ? formatSection("Recent Decisions", decisions) : null,
  ].filter((section): section is string => section !== null);

  return sections.join("\n\n");
}

function splitDecisionEntries(decisions: string): {
  prefix: string;
  entries: string[];
} {
  const trimmed = decisions.trim();
  const firstEntryIndex = trimmed.search(/^###\s/m);

  if (firstEntryIndex === -1) {
    return { prefix: "", entries: trimmed ? [trimmed] : [] };
  }

  const prefix = trimmed.slice(0, firstEntryIndex).trim();
  const remainder = trimmed.slice(firstEntryIndex).trim();
  const entries = remainder
    .split(/^###\s/m)
    .filter((entry) => entry.trim().length > 0)
    .map((entry) => `### ${entry.trim()}`);

  return { prefix, entries };
}

function joinDecisionEntries(prefix: string, entries: readonly string[]): string | null {
  const parts = [prefix.trim(), entries.join("\n\n").trim()].filter(
    (part) => part.length > 0,
  );

  return parts.length > 0 ? parts.join("\n\n") : null;
}

function truncateTail(content: string, overflow: number): string | null {
  if (overflow <= 0) {
    return content.trim() || null;
  }

  const nextLength = Math.max(0, content.length - overflow);
  const truncated = content.slice(0, nextLength).trimEnd();
  return truncated.length > 0 ? truncated : null;
}

function enforcePromptBudget(
  squadAgent: string,
  team: string,
  routing: string | null,
  decisions: string | null,
): string {
  let nextRouting = routing?.trim() || null;
  let nextDecisions = decisions?.trim() || null;
  let prompt = assemblePrompt(squadAgent, team, nextRouting, nextDecisions);

  if (prompt.length > MAX_PROMPT_CHARS && nextDecisions) {
    const { prefix, entries } = splitDecisionEntries(nextDecisions);
    let nextEntries = [...entries];

    while (prompt.length > MAX_PROMPT_CHARS && nextEntries.length > 1) {
      nextEntries = nextEntries.slice(0, -1);
      nextDecisions = joinDecisionEntries(prefix, nextEntries);
      prompt = assemblePrompt(squadAgent, team, nextRouting, nextDecisions);
    }

    if (prompt.length > MAX_PROMPT_CHARS && nextDecisions) {
      const overflow = prompt.length - MAX_PROMPT_CHARS;
      nextDecisions = truncateTail(nextDecisions, overflow);
      prompt = assemblePrompt(squadAgent, team, nextRouting, nextDecisions);
    }

    if (prompt.length <= MAX_PROMPT_CHARS && decisions?.trim() !== nextDecisions) {
      console.warn("[pi-squad] Truncated decisions.md to fit the coordinator prompt budget.");
    }
  }

  if (prompt.length > MAX_PROMPT_CHARS && nextRouting) {
    const overflow = prompt.length - MAX_PROMPT_CHARS;
    nextRouting = truncateTail(nextRouting, overflow);
    prompt = assemblePrompt(squadAgent, team, nextRouting, nextDecisions);

    if (routing?.trim() !== nextRouting) {
      console.warn("[pi-squad] Truncated routing.md to fit the coordinator prompt budget.");
    }
  }

  if (prompt.length > MAX_PROMPT_CHARS) {
    console.warn(
      "[pi-squad] Coordinator prompt exceeds MAX_PROMPT_CHARS after preserving required sections.",
    );
  }

  console.debug(`[pi-squad] Coordinator prompt: ${prompt.length} chars (~${estimateTokens(prompt.length)} tokens)`);

  return prompt;
}

export async function getSystemPrompt(teamRoot: string): Promise<string> {
  const teamPath = join(teamRoot, ".squad", TEAM_MD_FILENAME);
  const routingPath = join(teamRoot, ".squad", ROUTING_MD_FILENAME);
  const decisionsPath = join(teamRoot, ".squad", DECISIONS_MD_FILENAME);

  const squadVersionPromise = readFile(SQUAD_PACKAGE_JSON, "utf8")
    .then((raw) => {
      const pkg = JSON.parse(raw) as { version?: string };
      return pkg.version?.trim() ?? null;
    })
    .catch(() => {
      console.warn(
        "[pi-squad] Could not read squad/package.json — version display may show placeholder",
      );
      return null;
    });

  const [squadAgent, squadVersion, team, routing, decisions, workflowSection] = await Promise.all([
    readRequiredFile(SQUAD_AGENT_MD),
    squadVersionPromise,
    readOptionalFile(teamPath),
    readOptionalFile(routingPath),
    readOptionalFile(decisionsPath),
    buildWorkflowSection(),
  ]);

  const stampedSquadAgent = squadAgent.replace(
    /0\.0\.0-source/g,
    squadVersion ? squadVersion.trim() : "(version unknown)",
  );

  const coordinatorContent = [
    stampedSquadAgent.trim(),
    TWO_TIER_DESCRIPTION,
    ...(workflowSection ? [workflowSection] : []),
  ].join("\n\n");

  const normalizedTeam = team?.trim() || null;
  const sanitizedTeam = normalizedTeam
    ? (() => {
        // Sanitize .squad/ content before injection — mitigates stored prompt injection
        // via user-influenced agent writes (Aramaki Gap #1, 2026-06-03)
        const result = sanitize(normalizedTeam, { sourceType: "prompt" });
        if (result.issuesFound.length > 0) {
          console.warn(`[pi-squad] Sanitizer: team.md: ${result.issuesFound.join(", ")}`);
        }
        return result.text;
      })()
    : null;
  if (!sanitizedTeam) {
    console.warn("[pi-squad] Missing .squad/team.md; using minimal coordinator prompt.");
    return coordinatorContent;
  }

  const teamValidation = validateTeamMd(sanitizedTeam);
  for (const warning of teamValidation.warnings) {
    console.warn(`[pi-squad] team.md: ${warning}`);
  }

  const normalizedRouting = routing?.trim() || null;
  const sanitizedRouting = normalizedRouting
    ? (() => {
        // Sanitize .squad/ content before injection — mitigates stored prompt injection
        // via user-influenced agent writes (Aramaki Gap #1, 2026-06-03)
        const result = sanitize(normalizedRouting, { sourceType: "prompt" });
        if (result.issuesFound.length > 0) {
          console.warn(`[pi-squad] Sanitizer: routing.md: ${result.issuesFound.join(", ")}`);
        }
        return result.text;
      })()
    : null;
  const normalizedDecisions = decisions?.trim() || null;
  const sanitizedDecisions = normalizedDecisions
    ? (() => {
        // Sanitize .squad/ content before injection — mitigates stored prompt injection
        // via user-influenced agent writes (Aramaki Gap #1, 2026-06-03)
        const result = sanitize(normalizedDecisions, { sourceType: "prompt" });
        if (result.issuesFound.length > 0) {
          console.warn(`[pi-squad] Sanitizer: decisions.md: ${result.issuesFound.join(", ")}`);
        }
        return result.text;
      })()
    : null;
  return enforcePromptBudget(
    coordinatorContent,
    sanitizedTeam,
    sanitizedRouting,
    sanitizedDecisions && sanitizedDecisions.length > 0 ? sanitizedDecisions : null,
  );
}

export async function loadCoordinatorPrompt(coordinator: Coordinator): Promise<string> {
  return getSystemPrompt(await coordinator.getTeamRoot());
}

/**
 * Prepends the coordinator prompt to any existing system prompt.
 * Returns the coordinator prompt alone if no existing prompt is provided.
 */
export async function buildSystemPrompt(
  existingPrompt: string | undefined,
  coordinatorPrompt: string,
  coordinator: Coordinator,
): Promise<string> {
  const prompt = !existingPrompt
    ? coordinatorPrompt
    : `${coordinatorPrompt}${SECTION_SEPARATOR}${existingPrompt}`;

  if (!coordinator.isInitMode()) {
    return prompt;
  }

  const initCtx = coordinator.getInitContext();
  const skillPath = new URL("../../squad/.copilot/skills/init-mode/SKILL.md", import.meta.url);
  const initSkill = await readFile(skillPath, "utf8").catch(() => "");
  const contextBlock = [
    "## Init Context",
    `User: ${initCtx?.userName ?? "unknown"}`,
    `Project: ${initCtx?.projectName ?? "unknown"}`,
    initCtx?.detectedExtensions.length
      ? `Installed Pi extensions: ${initCtx.detectedExtensions.join(", ")}`
      : "No rpiv extensions detected — built-in ask_user_question is active.",
  ].join("\n");

  return [initSkill.trim(), contextBlock, prompt].filter((section) => section.length > 0).join("\n\n");
}
