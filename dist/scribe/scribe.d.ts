/**
 * @module scribe/scribe
 * The Scribe module — merges inbox decisions and writes session logs/history.
 */
export interface ScribeOptions {
    teamRoot: string;
    agentName: string;
}
/**
 * Merges all inbox decisions into .squad/decisions.md.
 * Returns the count of entries merged.
 */
export declare function mergeDecisions(options: ScribeOptions): Promise<number>;
/**
 * Appends a session log entry to .squad/log/{ISO-timestamp}-{topic}.md
 */
export declare function writeSessionLog(options: ScribeOptions, topic: string, content: string): Promise<void>;
/**
 * Appends to an agent's history.md.
 */
export declare function appendToHistory(teamRoot: string, agentName: string, content: string): Promise<void>;
//# sourceMappingURL=scribe.d.ts.map