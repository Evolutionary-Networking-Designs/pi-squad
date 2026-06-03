/**
 * @module coordinator/system-prompt
 * Loads and builds the Squad coordinator system prompt.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const SQUAD_AGENT_MD = fileURLToPath(new URL("../../../../squad/.github/agents/squad.agent.md", import.meta.url));
const SQUAD_VERSION_FILE = fileURLToPath(new URL("../../../../squad/VERSION", import.meta.url));
const TEAM_MD_FILENAME = "team.md";
const ROUTING_MD_FILENAME = "routing.md";
const DECISIONS_MD_FILENAME = "decisions.md";
const SECTION_SEPARATOR = "\n\n---\n# Squad Coordinator\n\n";
export const MAX_PROMPT_CHARS = 120_000;
export class SquadMissingError extends Error {
    constructor(filePath) {
        super(`Required Squad coordinator prompt missing: ${filePath}`);
        this.name = "SquadMissingError";
    }
}
function isMissingFile(error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}
async function readRequiredFile(filePath) {
    try {
        return await readFile(filePath, "utf8");
    }
    catch (error) {
        if (isMissingFile(error)) {
            throw new SquadMissingError(filePath);
        }
        throw error;
    }
}
async function readOptionalFile(filePath) {
    try {
        return await readFile(filePath, "utf8");
    }
    catch (error) {
        if (isMissingFile(error)) {
            return null;
        }
        throw error;
    }
}
function formatSection(title, content) {
    return `---\n## ${title}\n${content.trim()}`;
}
function assemblePrompt(squadAgent, team, routing, decisions) {
    const sections = [
        squadAgent.trim(),
        formatSection("Current Team", team),
        routing ? formatSection("Routing Rules", routing) : null,
        decisions ? formatSection("Recent Decisions", decisions) : null,
    ].filter((section) => section !== null);
    return sections.join("\n\n");
}
function splitDecisionEntries(decisions) {
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
function joinDecisionEntries(prefix, entries) {
    const parts = [prefix.trim(), entries.join("\n\n").trim()].filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join("\n\n") : null;
}
function truncateTail(content, overflow) {
    if (overflow <= 0) {
        return content.trim() || null;
    }
    const nextLength = Math.max(0, content.length - overflow);
    const truncated = content.slice(0, nextLength).trimEnd();
    return truncated.length > 0 ? truncated : null;
}
function enforcePromptBudget(squadAgent, team, routing, decisions) {
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
        console.warn("[pi-squad] Coordinator prompt exceeds MAX_PROMPT_CHARS after preserving required sections.");
    }
    return prompt;
}
export async function getSystemPrompt(teamRoot) {
    const teamPath = join(teamRoot, ".squad", TEAM_MD_FILENAME);
    const routingPath = join(teamRoot, ".squad", ROUTING_MD_FILENAME);
    const decisionsPath = join(teamRoot, ".squad", DECISIONS_MD_FILENAME);
    const squadVersionPromise = readFile(SQUAD_VERSION_FILE, "utf8").catch(() => {
        console.warn("[pi-squad] Could not read squad/VERSION — version display may show placeholder");
        return null;
    });
    const [squadAgent, squadVersion, team, routing, decisions] = await Promise.all([
        readRequiredFile(SQUAD_AGENT_MD),
        squadVersionPromise,
        readOptionalFile(teamPath),
        readOptionalFile(routingPath),
        readOptionalFile(decisionsPath),
    ]);
    const stampedSquadAgent = squadVersion
        ? squadAgent.replace(/0\.0\.0-source/g, squadVersion.trim())
        : squadAgent;
    const normalizedTeam = team?.trim() || null;
    if (!normalizedTeam) {
        console.warn("[pi-squad] Missing .squad/team.md; using minimal coordinator prompt.");
        return stampedSquadAgent.trim();
    }
    const normalizedDecisions = decisions?.trim() || null;
    return enforcePromptBudget(stampedSquadAgent, normalizedTeam, routing?.trim() || null, normalizedDecisions && normalizedDecisions.length > 0 ? normalizedDecisions : null);
}
export async function loadCoordinatorPrompt(coordinator) {
    return getSystemPrompt(await coordinator.getTeamRoot());
}
/**
 * Prepends the coordinator prompt to any existing system prompt.
 * Returns the coordinator prompt alone if no existing prompt is provided.
 */
export async function buildSystemPrompt(existingPrompt, coordinatorPrompt, coordinator) {
    const prompt = !existingPrompt
        ? coordinatorPrompt
        : `${coordinatorPrompt}${SECTION_SEPARATOR}${existingPrompt}`;
    if (!coordinator.isInitMode()) {
        return prompt;
    }
    const initCtx = coordinator.getInitContext();
    const skillPath = new URL("../../../../squad/.copilot/skills/init-mode/SKILL.md", import.meta.url);
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
//# sourceMappingURL=system-prompt.js.map