/**
 * @module scribe/drop-box
 * Drop-box file pattern utilities for the Squad inbox.
 */
/**
 * Write a decision to the inbox.
 * Returns the path written to: {teamRoot}/.squad/decisions/inbox/{agentName}-{slug}.md
 */
export declare function writeToInbox(teamRoot: string, agentName: string, slug: string, content: string): Promise<string>;
/**
 * List all inbox files (full paths).
 */
export declare function listInbox(teamRoot: string): Promise<string[]>;
/**
 * Read and delete an inbox file (for Scribe to merge).
 * Returns the file content.
 */
export declare function consumeInboxFile(filePath: string): Promise<string>;
//# sourceMappingURL=drop-box.d.ts.map