/**
 * @module context/ingestion/chunker
 * Semantic text chunker for the Docling ingestion pipeline.
 *
 * Splits markdown or plain text into chunks suitable for embedding and retrieval:
 * - Respects heading boundaries (never splits mid-heading)
 * - Prefers paragraph boundaries over sentence mid-points
 * - Targets configurable token count per chunk (default: 512)
 * - Adds token overlap between consecutive chunks (default: 50 tokens)
 *
 * Token estimation uses the same character-approximation as the context monitor
 * (chars / 4) — sufficient for chunking heuristics without a full tokenizer.
 */
const DEFAULT_TARGET_TOKENS = 512;
const DEFAULT_OVERLAP_TOKENS = 50;
const DEFAULT_MIN_TOKENS = 20;
/** Approximate tokens in a string using character-division heuristic. */
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
// ─── Heading detection ────────────────────────────────────────────────────────
/**
 * Returns true if the line is a markdown heading (# … ######).
 * Used as a preferred split boundary.
 */
function isHeading(line) {
    return /^#{1,6}\s/.test(line.trimStart());
}
// ─── Main export ──────────────────────────────────────────────────────────────
/**
 * Split markdown (or plain text) into chunks for embedding.
 *
 * Algorithm:
 * 1. Split on heading boundaries first — each heading starts a new section.
 * 2. Within each section, accumulate paragraphs until the target token count
 *    is reached, then emit a chunk.
 * 3. Apply overlap: carry the last `overlapTokens` worth of text from the
 *    previous chunk into the next chunk's prefix.
 * 4. Discard chunks smaller than `minTokens` by merging them with the
 *    previous chunk.
 *
 * @param text    Input markdown or plain text (UTF-8)
 * @param options Chunking configuration
 * @returns Array of text chunks ready for embedding
 */
export function chunkMarkdown(text, options) {
    const targetTokens = options?.targetTokens ?? DEFAULT_TARGET_TOKENS;
    const overlapTokens = options?.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;
    const minTokens = options?.minTokens ?? DEFAULT_MIN_TOKENS;
    // Split text into logical sections separated by headings
    const sections = splitIntoSections(text);
    const rawChunks = [];
    for (const section of sections) {
        const sectionChunks = chunkSection(section, targetTokens);
        rawChunks.push(...sectionChunks);
    }
    // Apply overlap between consecutive chunks
    const overlapped = applyOverlap(rawChunks, overlapTokens);
    // Merge undersized tail chunks into their predecessor
    return mergeTinyChunks(overlapped, minTokens);
}
// ─── Internal helpers ─────────────────────────────────────────────────────────
/**
 * Split a markdown document into sections delimited by headings.
 * Each section includes its heading line (if any) as the first element.
 */
function splitIntoSections(text) {
    const lines = text.split("\n");
    const sections = [];
    let current = [];
    for (const line of lines) {
        if (isHeading(line) && current.length > 0) {
            const section = current.join("\n").trim();
            if (section)
                sections.push(section);
            current = [line];
        }
        else {
            current.push(line);
        }
    }
    const last = current.join("\n").trim();
    if (last)
        sections.push(last);
    return sections;
}
/**
 * Chunk a single section by accumulating paragraphs up to targetTokens.
 * Paragraph boundaries are preferred split points within a section.
 */
function chunkSection(section, targetTokens) {
    const paragraphs = section.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    const chunks = [];
    let accum = [];
    let accumTokens = 0;
    for (const paragraph of paragraphs) {
        const paragraphTokens = estimateTokens(paragraph);
        // Single paragraph exceeds target — must split it by sentences
        if (paragraphTokens > targetTokens) {
            // Flush current accumulator first
            if (accum.length > 0) {
                chunks.push(accum.join("\n\n").trim());
                accum = [];
                accumTokens = 0;
            }
            chunks.push(...chunkBySentences(paragraph, targetTokens));
            continue;
        }
        if (accumTokens + paragraphTokens > targetTokens && accum.length > 0) {
            chunks.push(accum.join("\n\n").trim());
            accum = [paragraph];
            accumTokens = paragraphTokens;
        }
        else {
            accum.push(paragraph);
            accumTokens += paragraphTokens;
        }
    }
    if (accum.length > 0) {
        chunks.push(accum.join("\n\n").trim());
    }
    return chunks.filter((c) => c.length > 0);
}
/**
 * Last-resort splitter: split a single large paragraph by sentence boundaries.
 * Sentence boundary heuristic: `. `, `! `, `? ` followed by a capital letter.
 */
function chunkBySentences(text, targetTokens) {
    const sentenceRegex = /(?<=[.!?])\s+(?=[A-Z])/g;
    const sentences = text.split(sentenceRegex).filter((s) => s.trim().length > 0);
    const chunks = [];
    let accum = [];
    let accumTokens = 0;
    for (const sentence of sentences) {
        const sentenceTokens = estimateTokens(sentence);
        if (accumTokens + sentenceTokens > targetTokens && accum.length > 0) {
            chunks.push(accum.join(" ").trim());
            accum = [sentence];
            accumTokens = sentenceTokens;
        }
        else {
            accum.push(sentence);
            accumTokens += sentenceTokens;
        }
    }
    if (accum.length > 0) {
        chunks.push(accum.join(" ").trim());
    }
    return chunks.filter((c) => c.length > 0);
}
/**
 * Add overlapping context between consecutive chunks.
 * Each chunk (except the first) is prefixed with the last `overlapTokens`
 * worth of text from the previous chunk.
 */
function applyOverlap(chunks, overlapTokens) {
    if (overlapTokens <= 0 || chunks.length <= 1)
        return chunks;
    return chunks.map((chunk, i) => {
        if (i === 0)
            return chunk;
        const prev = chunks[i - 1];
        const overlapText = extractTailTokens(prev, overlapTokens);
        if (!overlapText || chunk.startsWith(overlapText))
            return chunk;
        return `${overlapText}\n\n${chunk}`;
    });
}
/**
 * Extract approximately `tokenCount` tokens from the tail of a text string.
 * Used to compute the overlap prefix for the next chunk.
 */
function extractTailTokens(text, tokenCount) {
    const charCount = tokenCount * 4;
    if (text.length <= charCount)
        return text;
    // Find a sentence boundary near the target character position
    const tail = text.slice(-charCount);
    const firstSentenceEnd = tail.search(/[.!?]\s/);
    if (firstSentenceEnd > 0) {
        return tail.slice(firstSentenceEnd + 1).trim();
    }
    return tail.trim();
}
/**
 * Merge chunks that are smaller than minTokens into their predecessor.
 * Prevents tiny orphan chunks (e.g., a lone heading or a one-line summary).
 */
function mergeTinyChunks(chunks, minTokens) {
    if (chunks.length === 0)
        return chunks;
    const result = [chunks[0]];
    for (let i = 1; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (estimateTokens(chunk) < minTokens) {
            result[result.length - 1] = `${result[result.length - 1]}\n\n${chunk}`;
        }
        else {
            result.push(chunk);
        }
    }
    return result;
}
//# sourceMappingURL=chunker.js.map