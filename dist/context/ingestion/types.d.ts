/**
 * @module context/ingestion/types
 * Shared types for the Docling-based knowledge ingestion pipeline.
 *
 * These types cover the document ingestion lifecycle:
 *   convert (Docling) → chunk (chunker) → embed (@xenova) → store (VectorBackend)
 */
/**
 * Metadata attached to an ingested document and stored alongside each chunk embedding.
 * Allows filtering search results by source, type, or custom tags.
 */
export interface DocMetadata {
    /** Absolute or team-root-relative path to the source file */
    readonly sourcePath: string;
    /**
     * MIME type or inferred file category.
     * Examples: 'text/markdown', 'application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
     */
    readonly mimeType: string;
    /** ISO 8601 timestamp when the document was ingested */
    readonly ingestedAt: string;
    /** Optional human-readable title (extracted from content or filename) */
    readonly title?: string;
    /** Optional free-form tags for filtering */
    readonly tags?: readonly string[];
    /**
     * Zero-indexed chunk position within the source document.
     * Set by the pipeline — not provided by callers.
     */
    readonly chunkIndex?: number;
    /**
     * Total number of chunks this document was split into.
     * Set by the pipeline — not provided by callers.
     */
    readonly totalChunks?: number;
}
/** Outcome of a single document ingestion attempt. */
export interface IngestFileResult {
    /** Absolute path to the ingested file */
    readonly filePath: string;
    /** Whether ingestion succeeded */
    readonly success: boolean;
    /** Number of chunks stored (0 on failure) */
    readonly chunksStored: number;
    /** Error message if ingestion failed */
    readonly error?: string;
}
/** Aggregate result of a batch directory ingestion. */
export interface IngestResult {
    /** Number of files successfully ingested */
    readonly succeeded: number;
    /** Number of files that failed ingestion */
    readonly failed: number;
    /** Total chunks stored across all successful files */
    readonly totalChunksStored: number;
    /** Per-file results */
    readonly files: readonly IngestFileResult[];
}
/** Options for the markdown/text chunker. */
export interface ChunkOptions {
    /**
     * Target token count per chunk.
     * Chunker aims for this size; actual chunks may be slightly larger or smaller
     * to respect sentence/paragraph boundaries.
     * Default: 512
     */
    readonly targetTokens?: number;
    /**
     * Overlap in tokens between consecutive chunks.
     * Preserves cross-boundary context for RAG retrieval.
     * Default: 50
     */
    readonly overlapTokens?: number;
    /**
     * Minimum token count for a chunk to be kept.
     * Chunks smaller than this are merged with the previous chunk.
     * Default: 20
     */
    readonly minTokens?: number;
}
/** Callback invoked after each file is processed during batch ingestion. */
export type IngestProgressCallback = (result: IngestFileResult, index: number, total: number) => void;
//# sourceMappingURL=types.d.ts.map