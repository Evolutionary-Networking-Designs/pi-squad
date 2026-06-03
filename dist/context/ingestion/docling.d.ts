/**
 * @module context/ingestion/docling
 * Docling bridge — converts documents to markdown via subprocess call.
 *
 * Docling (https://www.docling.ai/, IBM, MIT license) is a Python library that
 * converts PDFs, Word docs, HTML, images, and more to structured markdown or JSON.
 * It runs 100% locally with no cloud API calls.
 *
 * Since pi-squad is TypeScript, we bridge Docling via a child_process shell-out:
 *   python3 -m docling <filePath>
 *
 * Graceful fallback hierarchy:
 *   1. Docling via `python3 -m docling` (if available)
 *   2. Docling via `docling convert` CLI (if installed as standalone command)
 *   3. Plain fs.readFile for .txt and .md files
 *   4. Warning + empty string for binary formats without Docling
 *
 * Extension must function without Docling installed — only rich document conversion
 * is degraded. Plain text and markdown files always work via fs.readFile fallback.
 */
/**
 * Check whether Docling is available in the current environment.
 * Tries `python3 -m docling --help` first, then `docling --help` CLI.
 * Result is cached after the first call.
 *
 * @returns true if Docling can be invoked, false otherwise
 */
export declare function isDoclingAvailable(): Promise<boolean>;
/**
 * Convert a document to markdown using Docling.
 *
 * Attempts conversion via `python3 -m docling {filePath}` then `docling convert`.
 * Falls back to plain fs.readFile for .txt / .md when Docling is unavailable.
 * Emits a console.warn (not a throw) for binary files without Docling.
 *
 * @param filePath Absolute path to the document to convert
 * @returns Markdown string (may be empty string on unrecoverable failure)
 */
export declare function convertDocument(filePath: string): Promise<string>;
/**
 * Reset the Docling availability cache.
 * Useful in tests or after installing Docling mid-session.
 */
export declare function resetDoclingAvailabilityCache(): void;
//# sourceMappingURL=docling.d.ts.map