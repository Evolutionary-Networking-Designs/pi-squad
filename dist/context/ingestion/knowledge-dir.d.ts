/**
 * @module context/ingestion/knowledge-dir
 * Knowledge directory management for the drop-folder ingestion pattern.
 *
 * Convention: `.squad/knowledge/` is the user-facing drop folder.
 * Drop any document here (PDF, Word, HTML, .md, .txt) and pi-squad will
 * auto-ingest it at session start.
 *
 * Manifest: `.squad/knowledge/.ingested` — newline-delimited list of
 * already-ingested file paths. Git-ignored by default (see .gitignore).
 *
 * Usage:
 * ```typescript
 * initKnowledgeDir(teamRoot);
 * const newFiles = await scanKnowledgeDir(teamRoot);
 * // ingest newFiles...
 * for (const f of newFiles) markIngested(f);
 * ```
 */
/**
 * Ensure `.squad/knowledge/` exists and contains a properly-configured
 * `.gitignore` that ignores binary files (PDFs, Word docs, etc.) while
 * allowing markdown and text files to be committed.
 *
 * Safe to call on every session start — idempotent.
 *
 * @param teamRoot Absolute path to the `.squad/` parent directory (repo root)
 */
export declare function initKnowledgeDir(teamRoot: string): void;
/**
 * Scan `.squad/knowledge/` for files that have not yet been ingested.
 * Compares the directory listing against the `.ingested` manifest.
 *
 * @param teamRoot Absolute path to the `.squad/` parent directory (repo root)
 * @returns Absolute paths of files not yet recorded in the manifest
 */
export declare function scanKnowledgeDir(teamRoot: string): Promise<string[]>;
/**
 * Mark a file as ingested by appending its path to the `.ingested` manifest.
 * Subsequent calls to `scanKnowledgeDir` will not return this file.
 *
 * @param teamRoot Absolute path to the `.squad/` parent directory (repo root)
 * @param filePath Absolute path of the file to mark as ingested
 */
export declare function markIngested(teamRoot: string, filePath: string): void;
/**
 * Resolve the absolute path to `.squad/knowledge/`.
 *
 * @param teamRoot Absolute path to the `.squad/` parent directory (repo root)
 */
export declare function resolveKnowledgeDir(teamRoot: string): string;
//# sourceMappingURL=knowledge-dir.d.ts.map