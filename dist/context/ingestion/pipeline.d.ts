/**
 * @module context/ingestion/pipeline
 * Docling ingestion pipeline — convert → sanitize → chunk → embed → store.
 *
 * The pipeline is dependency-injected:
 *   - `backend`: VectorBackend (sqlite-vec or pgvector)
 *   - `embedFn`: async text → Float32Array(384) (from @huggingface/transformers)
 *
 * Sanitization is a HARD GATE: no raw content may be embedded without passing
 * through the sanitizer. The sourceType parameter controls sanitization intensity
 * ('document' for local files, 'web' for untrusted external content).
 *
 * This keeps the pipeline decoupled from storage and embedding implementations.
 * The coordinator wires these dependencies at startup.
 *
 * Usage:
 * ```typescript
 * const pipeline = createIngestionPipeline(backend, embedFn);
 * await pipeline.ingestDocument("/path/to/doc.pdf");
 * await pipeline.ingestDirectory(".squad/knowledge/");
 * pipeline.watchKnowledgeDir(".squad/knowledge/");
 * ```
 */
import type { SourceType } from "./sanitizer.js";
import type { DocMetadata, IngestResult, ChunkOptions, IngestProgressCallback } from "./types.js";
import type { VectorBackend } from "../backends/types.js";
export interface IngestionPipeline {
    /**
     * Ingest a single document: convert → chunk → embed → store.
     * Returns the embedding IDs of stored chunks.
     *
     * @param filePath Absolute path to the document
     * @param metadata Optional metadata to attach (chunkIndex/totalChunks set automatically)
     * @param options  Chunking options
     * @returns IDs of stored chunk embeddings
     */
    ingestDocument(filePath: string, metadata?: Partial<DocMetadata>, options?: ChunkOptions): Promise<string[]>;
    /**
     * Batch-ingest all eligible files in a directory.
     * Files are filtered by supported extension. Subdirectories are NOT traversed.
     *
     * @param dirPath  Absolute path to directory
     * @param glob     Optional extension filter (e.g. '*.md') — simple suffix match only
     * @param onProgress Optional callback invoked after each file
     * @returns Aggregate ingestion result
     */
    ingestDirectory(dirPath: string, glob?: string, onProgress?: IngestProgressCallback): Promise<IngestResult>;
    /**
     * Watch a directory for new or changed files and auto-ingest them.
     * Uses Node.js fs.watch — no external dependencies.
     * Fires on 'rename' (new file) and 'change' (modified file).
     *
     * Call the returned function to stop watching.
     *
     * @param knowledgeDir Absolute path to watch
     * @returns stop function — call to remove the watcher
     */
    watchKnowledgeDir(knowledgeDir: string): () => void;
}
/**
 * Create a configured IngestionPipeline.
 *
 * @param backend    VectorBackend — must already be initialized
 * @param embedFn    Async function that embeds a text string into Float32Array(384)
 * @param sourceType Content origin for sanitization — 'document' (default) or 'web'
 */
export declare function createIngestionPipeline(backend: VectorBackend, embedFn: (text: string) => Promise<Float32Array>, sourceType?: SourceType): IngestionPipeline;
//# sourceMappingURL=pipeline.d.ts.map