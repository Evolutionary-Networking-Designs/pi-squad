/**
 * @module coordinator/system-prompt
 * Loads and builds the Squad coordinator system prompt.
 */
import type { Coordinator } from "./coordinator.js";
export declare const MAX_PROMPT_CHARS = 120000;
export declare class SquadMissingError extends Error {
    constructor(filePath: string);
}
export declare function getSystemPrompt(teamRoot: string): Promise<string>;
export declare function loadCoordinatorPrompt(coordinator: Coordinator): Promise<string>;
/**
 * Prepends the coordinator prompt to any existing system prompt.
 * Returns the coordinator prompt alone if no existing prompt is provided.
 */
export declare function buildSystemPrompt(existingPrompt: string | undefined, coordinatorPrompt: string): string;
//# sourceMappingURL=system-prompt.d.ts.map