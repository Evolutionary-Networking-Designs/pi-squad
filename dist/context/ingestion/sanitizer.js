/**
 * @module context/ingestion/sanitizer
 * Mandatory sanitization gate for all content entering the vector store.
 *
 * Three modes:
 *   - 'document' (default): moderate — strips control chars, secrets, normalises Unicode
 *   - 'prompt': document mode + role-boundary/system-token stripping for safe prompt assembly
 *   - 'web': aggressive — superset of document, plus HTML stripping and tracking removal
 *
 * This module has zero external dependencies — pure TypeScript/stdlib only.
 *
 * Usage:
 * ```typescript
 * const { text, truncated, issuesFound } = sanitize(rawContent, { sourceType: 'web' });
 * ```
 */
// ─── Secret Patterns ─────────────────────────────────────────────────────────
/** OpenAI-style API key: sk- followed by 20+ alphanumeric chars */
const RE_SK_KEY = /sk-[A-Za-z0-9]{20,}/g;
/** GitHub personal access token */
const RE_GHP_KEY = /ghp_[A-Za-z0-9]{36}/g;
/** PEM-encoded private key blocks */
const RE_PEM_KEY = /-----BEGIN[\s\S]*?-----/g;
/** Long base64 strings that look like encoded secrets (40+ chars ending in =) */
const RE_BASE64_KEY = /[A-Za-z0-9+/]{40,}={1,2}/g;
// ─── Prompt Injection Patterns ────────────────────────────────────────────────
const INJECTION_PATTERNS = [
    { pattern: /\nHuman:/g, label: 'prompt-injection: \\nHuman:' },
    { pattern: /\nAssistant:/g, label: 'prompt-injection: \\nAssistant:' },
    { pattern: /###SYSTEM###/g, label: 'prompt-injection: ###SYSTEM###' },
    { pattern: /<\|im_start\|>/g, label: 'prompt-injection: <|im_start|>' },
    { pattern: /IGNORE PREVIOUS INSTRUCTIONS/gi, label: 'prompt-injection: IGNORE PREVIOUS INSTRUCTIONS' },
];
// ─── Tracking / Analytics Strings (web mode) ─────────────────────────────────
const RE_TRACKING_STRINGS = [
    /\bga\('send'[\s\S]*?\)/g,
    /\bgtag\([\s\S]*?\)/g,
    /\b_paq\.push\([\s\S]*?\)/g,
    /__utm[a-z]+=[^&\s"']*/g,
];
/** URLs that look like tracking pixels: short URL with utm_ query params */
const RE_TRACKING_URL = /https?:\/\/\S{1,80}\?[^"'\s]*utm_[^"'\s]*/g;
// ─── Core Implementation ──────────────────────────────────────────────────────
/**
 * Sanitize text before it enters the vector store.
 *
 * Never throws — all errors are surfaced via `issuesFound`.
 * Truncation is applied last so earlier rules operate on full text.
 */
export function sanitize(text, options) {
    const sourceType = options?.sourceType ?? 'document';
    const aggressive = options?.aggressiveMode ?? sourceType === 'web';
    const shouldStripHtml = options?.stripHtml ?? sourceType === 'web';
    const stripRoleBoundaries = aggressive || sourceType === 'prompt';
    const defaultMax = sourceType === 'web' ? 256_000 : 512_000;
    const maxLength = options?.maxLength ?? defaultMax;
    const issues = [];
    let out = text;
    // ── Web-only pre-pass: remove script/style blocks before any other stripping ──
    if (aggressive) {
        const beforeScript = out.length;
        out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
        out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
        if (out.length !== beforeScript) {
            issues.push('stripped <script>/<style> blocks');
        }
        // Tracking analytics strings
        let trackingCount = 0;
        for (const re of RE_TRACKING_STRINGS) {
            out = out.replace(re, () => { trackingCount++; return ''; });
        }
        if (trackingCount > 0) {
            issues.push(`stripped ${trackingCount} tracking/analytics string(s)`);
        }
        // Tracking pixel URLs
        const urlsBefore = out.length;
        out = out.replace(RE_TRACKING_URL, '');
        if (out.length !== urlsBefore) {
            issues.push('stripped tracking pixel URL(s)');
        }
    }
    // ── HTML tag stripping ────────────────────────────────────────────────────────
    if (shouldStripHtml) {
        const before = out.length;
        // Strip remaining HTML tags (attributes included)
        out = out.replace(/<[^>]{0,2000}>/g, '');
        // Decode common HTML entities
        out = out
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ');
        if (out.length !== before) {
            issues.push('stripped HTML tags');
        }
    }
    // ── Null bytes and disallowed control characters ───────────────────────────
    const before = out.length;
    // Keep \n (0x0A), \t (0x09); strip everything else in C0 range plus DEL (0x7F)
    out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    if (out.length !== before) {
        issues.push('stripped null bytes / control characters');
    }
    // ── Secret patterns ───────────────────────────────────────────────────────────
    let secretCount = 0;
    const countAndStrip = (re) => out.replace(re, () => { secretCount++; return '[REDACTED]'; });
    out = countAndStrip(RE_SK_KEY);
    out = countAndStrip(RE_GHP_KEY);
    out = countAndStrip(RE_PEM_KEY);
    out = countAndStrip(RE_BASE64_KEY);
    if (secretCount > 0) {
        issues.push(`redacted ${secretCount} secret pattern(s)`);
    }
    // ── Prompt injection (web + prompt mode) ─────────────────────────────────────
    if (stripRoleBoundaries) {
        for (const { pattern, label } of INJECTION_PATTERNS) {
            const before2 = out.length;
            out = out.replace(pattern, '');
            if (out.length !== before2) {
                issues.push(label);
            }
        }
    }
    // ── Unicode normalisation ─────────────────────────────────────────────────────
    out = out.normalize('NFC');
    // ── Excessive blank lines (3+ consecutive → 2) ────────────────────────────────
    const beforeBlanks = out.length;
    out = out.replace(/(\n[ \t]*){3,}/g, '\n\n');
    if (out.length !== beforeBlanks) {
        issues.push('collapsed excessive blank lines');
    }
    // ── Truncation ────────────────────────────────────────────────────────────────
    let truncated = false;
    if (out.length > maxLength) {
        out = out.slice(0, maxLength);
        truncated = true;
        issues.push(`truncated at ${maxLength} chars`);
    }
    return { text: out, truncated, issuesFound: issues };
}
//# sourceMappingURL=sanitizer.js.map