/**
 * @module coordinator/composite-prompt
 *
 * Typed composite prompt assembly for multi-team coordinator prompts.
 */
import type { TeamStack } from "../types.js";
export type PromptSectionKey = "governance" | "root.team" | "local.team" | "root.routing" | "local.routing" | "root.decisions" | "local.decisions" | "agent.identity";
export type TruncatableSectionKey = Extract<PromptSectionKey, "root.decisions" | "local.decisions" | "root.routing" | "local.routing">;
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
export declare const TRUNCATION_ORDER: ReadonlyArray<TruncatableSectionKey>;
export declare class CompositePromptError extends Error {
    readonly missingSections: PromptSectionKey[];
    constructor(missingSections: PromptSectionKey[], message?: string);
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
export declare function getCompositeSystemPrompt(stack: TeamStack, agentMd: string, budgetChars?: number): Promise<string>;
//# sourceMappingURL=composite-prompt.d.ts.map