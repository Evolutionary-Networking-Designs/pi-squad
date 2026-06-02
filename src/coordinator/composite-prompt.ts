/**
 * @module coordinator/composite-prompt
 *
 * Typed composite prompt assembly for multi-team coordinator prompts.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { TeamStack } from "../types.js";
import { MAX_PROMPT_CHARS } from "./system-prompt.js";

const TEAM_FILENAME = "team.md";
const DECISIONS_FILENAME = "decisions.md";

export type PromptSectionKey =
  | "governance"
  | "root.team"
  | "local.team"
  | "root.routing"
  | "local.routing"
  | "root.decisions"
  | "local.decisions"
  | "agent.identity";

export type TruncatableSectionKey = Extract<
  PromptSectionKey,
  "root.decisions" | "local.decisions" | "root.routing" | "local.routing"
>;

export interface PromptSection {
  readonly key: PromptSectionKey;
  readonly level: "governance" | "root" | "local";
  readonly content: string;
  readonly required: boolean;
  readonly truncationPriority: number;
  readonly charCount: number;
}

/**
 * Ordered list of section keys that may be truncated when over budget.
 * Lower index = dropped first. Required sections are never truncated.
 *
 * ⚠️ INVARIANT: This array MUST match GracefulDegradeStrategyConfig.dropOrder
 * in src/context/recovery.ts. Keep them in sync.
 */
export const TRUNCATION_ORDER: ReadonlyArray<TruncatableSectionKey> = [
  "root.decisions",
  "local.decisions",
  "root.routing",
  "local.routing",
] as const;

const REQUIRED_SECTIONS: ReadonlyArray<PromptSectionKey> = ["governance", "root.team"];

export class CompositePromptError extends Error {
  readonly missingSections: PromptSectionKey[];

  constructor(missingSections: PromptSectionKey[], message?: string) {
    super(message ?? `Required prompt sections missing: ${missingSections.join(", ")}`);
    this.name = "CompositePromptError";
    this.missingSections = missingSections;
    Object.setPrototypeOf(this, CompositePromptError.prototype);
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
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

function normalizeContent(content: string | null | undefined): string | null {
  const normalized = content?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function getTruncationPriority(key: PromptSectionKey): number {
  const priority = TRUNCATION_ORDER.indexOf(key as TruncatableSectionKey);
  return priority === -1 ? Number.POSITIVE_INFINITY : priority;
}

function createSection(
  key: PromptSectionKey,
  level: PromptSection["level"],
  content: string,
  required: boolean,
): PromptSection {
  return {
    key,
    level,
    content,
    required,
    truncationPriority: getTruncationPriority(key),
    charCount: content.length,
  };
}

function splitAgentMd(agentMd: string): {
  governance: string | null;
  identity: string | null;
} {
  const normalized = normalizeContent(agentMd);
  if (!normalized) {
    return { governance: null, identity: null };
  }

  const lines = normalized.split(/\r?\n/u);
  const startIndex = lines.findIndex((line) => line.trim() === "### Coordinator Identity");
  if (startIndex === -1) {
    return { governance: normalized, identity: null };
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line === "---") {
      endIndex = index;
      break;
    }
  }

  const identity = normalizeContent(lines.slice(startIndex, endIndex).join("\n"));
  const governance = normalizeContent(
    [...lines.slice(0, startIndex), ...lines.slice(endIndex)].join("\n"),
  );

  return { governance, identity };
}

function getSectionContent(
  sections: readonly PromptSection[],
  key: PromptSectionKey,
): string | null {
  return sections.find((section) => section.key === key)?.content ?? null;
}

function formatSection(title: string, content: string | null): string | null {
  if (!content) {
    return null;
  }

  return `## ${title}\n${content}`;
}

function assemblePrompt(stack: TeamStack, sections: readonly PromptSection[]): string {
  const governance = getSectionContent(sections, "governance");
  const identity = getSectionContent(sections, "agent.identity");
  const rootBlocks = [
    formatSection("Team Context (Root)", getSectionContent(sections, "root.team")),
    formatSection("Routing (Root)", getSectionContent(sections, "root.routing")),
    formatSection("Decisions (Root)", getSectionContent(sections, "root.decisions")),
  ].filter((section): section is string => section !== null);

  const promptParts = [governance, identity].filter(
    (section): section is string => section !== null,
  );

  if (rootBlocks.length > 0) {
    promptParts.push(`---\n${rootBlocks.join("\n\n")}`);
  }

  if (!stack.isSingleTeam) {
    const localBlocks = [
      formatSection(
        `Team Context (Local: ${stack.local.config.name})`,
        getSectionContent(sections, "local.team"),
      ),
      formatSection("Routing (Local)", getSectionContent(sections, "local.routing")),
      formatSection("Decisions (Local)", getSectionContent(sections, "local.decisions")),
    ].filter((section): section is string => section !== null);

    if (localBlocks.length > 0) {
      promptParts.push(`---\n${localBlocks.join("\n\n")}`);
    }
  }

  return promptParts.join("\n\n");
}

function getMissingRequiredSections(sections: readonly PromptSection[]): PromptSectionKey[] {
  return REQUIRED_SECTIONS.filter(
    (requiredKey) => !sections.some((section) => section.key === requiredKey && section.content.length > 0),
  );
}

function assertRequiredSectionsPresent(sections: readonly PromptSection[]): void {
  const missingSections = getMissingRequiredSections(sections);
  if (missingSections.length > 0) {
    throw new CompositePromptError(missingSections);
  }
}

function enforcePromptBudget(
  stack: TeamStack,
  sections: readonly PromptSection[],
  budgetChars: number,
): readonly PromptSection[] {
  let nextSections = [...sections];
  const droppedSections: PromptSectionKey[] = [];

  for (const sectionKey of TRUNCATION_ORDER) {
    if (assemblePrompt(stack, nextSections).length <= budgetChars) {
      break;
    }

    const section = nextSections.find((candidate) => candidate.key === sectionKey);
    if (!section || section.required) {
      continue;
    }

    nextSections = nextSections.filter((candidate) => candidate.key !== sectionKey);
    droppedSections.push(section.key);
  }

  if (droppedSections.length > 0) {
    console.warn(
      `[pi-squad] Truncated composite coordinator prompt to fit budget. Dropped sections: ${droppedSections.join(
        ", ",
      )}.`,
    );
  }

  if (assemblePrompt(stack, nextSections).length > budgetChars) {
    console.warn(
      "[pi-squad] Composite coordinator prompt exceeds budget after preserving required sections.",
    );
  }

  return nextSections;
}

function buildSections(
  stack: TeamStack,
  agentSections: { governance: string | null; identity: string | null },
  rootTeam: string | null,
  localTeam: string | null,
  rootRouting: string | null,
  localRouting: string | null,
  rootDecisions: string | null,
  localDecisions: string | null,
): PromptSection[] {
  const sections: PromptSection[] = [];

  if (agentSections.governance) {
    sections.push(createSection("governance", "governance", agentSections.governance, true));
  }

  if (agentSections.identity) {
    sections.push(createSection("agent.identity", "governance", agentSections.identity, false));
  }

  if (rootTeam) {
    sections.push(createSection("root.team", "root", rootTeam, true));
  }

  if (rootRouting) {
    sections.push(createSection("root.routing", "root", rootRouting, false));
  }

  if (rootDecisions) {
    sections.push(createSection("root.decisions", "root", rootDecisions, false));
  }

  if (!stack.isSingleTeam) {
    if (localTeam) {
      sections.push(createSection("local.team", "local", localTeam, false));
    }

    if (localRouting) {
      sections.push(createSection("local.routing", "local", localRouting, false));
    }

    if (localDecisions) {
      sections.push(createSection("local.decisions", "local", localDecisions, false));
    }
  }

  return sections;
}

/**
 * Assembles the composite coordinator system prompt from a TeamStack.
 * Applies TypeScript-as-ruleset enforcement: required sections are validated
 * at assembly time; optional sections are truncated by priority if over budget.
 *
 * @param stack - resolved team stack (from resolveTeamStack())
 * @param agentMd - contents of squad.agent.md (governance)
 * @param budgetChars - max total prompt chars (default: MAX_PROMPT_CHARS from system-prompt.ts)
 * @returns assembled prompt string
 * @throws CompositePromptError if required sections are missing
 */
export async function getCompositeSystemPrompt(
  stack: TeamStack,
  agentMd: string,
  budgetChars: number = MAX_PROMPT_CHARS,
): Promise<string> {
  const [rootTeam, localTeam, rootRouting, localRouting, rootDecisions, localDecisions] =
    await Promise.all([
      readOptionalFile(join(stack.root.squadPath, TEAM_FILENAME)),
      stack.isSingleTeam ? Promise.resolve(null) : readOptionalFile(join(stack.local.squadPath, TEAM_FILENAME)),
      readOptionalFile(stack.root.routingPath),
      stack.isSingleTeam ? Promise.resolve(null) : readOptionalFile(stack.local.routingPath),
      readOptionalFile(join(stack.root.squadPath, DECISIONS_FILENAME)),
      stack.isSingleTeam
        ? Promise.resolve(null)
        : readOptionalFile(join(stack.local.squadPath, DECISIONS_FILENAME)),
    ]);

  const sections = buildSections(
    stack,
    splitAgentMd(agentMd),
    normalizeContent(rootTeam),
    normalizeContent(localTeam),
    normalizeContent(rootRouting),
    normalizeContent(localRouting),
    normalizeContent(rootDecisions),
    normalizeContent(localDecisions),
  );

  assertRequiredSectionsPresent(sections);

  const prompt = assemblePrompt(stack, enforcePromptBudget(stack, sections, budgetChars));
  if (prompt.length === 0) {
    throw new CompositePromptError(REQUIRED_SECTIONS.slice(), "Composite prompt assembled to an empty string.");
  }

  return prompt;
}
