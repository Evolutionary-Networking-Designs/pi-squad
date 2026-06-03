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
import type { ChunkOptions } from "./types.js";
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
export declare function chunkMarkdown(text: string, options?: ChunkOptions): string[];
//# sourceMappingURL=chunker.d.ts.map