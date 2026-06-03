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
// ─── Docling bridge ───────────────────────────────────────────────────────────
export { isDoclingAvailable, convertDocument, resetDoclingAvailabilityCache, } from "./docling.js";
// ─── Chunker ──────────────────────────────────────────────────────────────────
export { chunkMarkdown } from "./chunker.js";
// ─── Pipeline ─────────────────────────────────────────────────────────────────
export { createIngestionPipeline } from "./pipeline.js";
// ─── Sanitizer ────────────────────────────────────────────────────────────────
export { sanitize } from "./sanitizer.js";
// ─── Knowledge directory ──────────────────────────────────────────────────────
export { initKnowledgeDir, scanKnowledgeDir, markIngested, resolveKnowledgeDir, } from "./knowledge-dir.js";
//# sourceMappingURL=index.js.map