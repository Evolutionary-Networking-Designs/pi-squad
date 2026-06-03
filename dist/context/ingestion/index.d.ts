/**
 * @module context/ingestion
 * Docling-based knowledge ingestion pipeline for pi-squad.
 *
 * Exports the full ingestion API:
 * - Docling bridge (isDoclingAvailable, convertDocument)
 * - Text chunker (chunkMarkdown)
 * - Ingestion pipeline (createIngestionPipeline, IngestionPipeline)
 * - Knowledge directory management (initKnowledgeDir, scanKnowledgeDir, markIngested)
 * - Shared types (DocMetadata, IngestResult, ChunkOptions, etc.)
 */
export type { DocMetadata, IngestResult, IngestFileResult, ChunkOptions, IngestProgressCallback, } from "./types.js";
export { isDoclingAvailable, convertDocument, resetDoclingAvailabilityCache, } from "./docling.js";
export { chunkMarkdown } from "./chunker.js";
export { createIngestionPipeline } from "./pipeline.js";
export type { IngestionPipeline } from "./pipeline.js";
export { sanitize } from "./sanitizer.js";
export type { SanitizerOptions, SanitizeResult, SourceType } from "./sanitizer.js";
export { initKnowledgeDir, scanKnowledgeDir, markIngested, resolveKnowledgeDir, } from "./knowledge-dir.js";
//# sourceMappingURL=index.d.ts.map