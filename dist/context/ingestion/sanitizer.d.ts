/**
 * @module context/ingestion/sanitizer
 * Mandatory sanitization gate for all content entering the vector store.
 *
 * Two modes:
 *   - 'document' (default): moderate — strips control chars, secrets, normalises Unicode
 *   - 'web': aggressive — superset of document, plus HTML stripping and prompt-injection detection
 *
 * This module has zero external dependencies — pure TypeScript/stdlib only.
 *
 * Usage:
 * ```typescript
 * const { text, truncated, issuesFound } = sanitize(rawContent, { sourceType: 'web' });
 * ```
 */
export type SourceType = 'document' | 'web';
export interface SanitizerOptions {
    /** Content origin — drives which rule set is applied. Default: 'document' */
    sourceType?: SourceType;
    /** Hard truncation limit in characters. Default: 512_000 (document), 256_000 (web) */
    maxLength?: number;
    /** Strip HTML tags. Auto-enabled for 'web'. Default: false */
    stripHtml?: boolean;
    /** Apply aggressive web rules. Auto-enabled for 'web'. Default: false */
    aggressiveMode?: boolean;
}
export interface SanitizeResult {
    /** The sanitized text, ready for chunking and embedding */
    text: string;
    /** True if the input was longer than maxLength and was truncated */
    truncated: boolean;
    /** Descriptions of each issue found, for audit logging */
    issuesFound: string[];
}
/**
 * Sanitize text before it enters the vector store.
 *
 * Never throws — all errors are surfaced via `issuesFound`.
 * Truncation is applied last so earlier rules operate on full text.
 */
export declare function sanitize(text: string, options?: SanitizerOptions): SanitizeResult;
//# sourceMappingURL=sanitizer.d.ts.map