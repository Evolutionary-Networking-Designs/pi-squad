/**
 * @module context
 * Context monitoring and explicit recovery for the Squad coordinator.
 *
 * This module provides:
 * - Token estimation (native or character-approximation fallback)
 * - Context pressure monitoring with typed threshold events
 * - Recovery strategies that activate at configurable pressure levels
 * - A recovery orchestrator that sequences strategies and throws on failure
 *
 * Usage from the coordinator:
 * ```typescript
 * import {
 *   type ContextMonitor,
 *   type RecoveryOrchestrator,
 *   type ContextMonitorConfig,
 *   ContextPressureLevel,
 *   ContextOverflowError,
 * } from "./context/index.js";
 * ```
 *
 * Architecture: The monitor observes, the orchestrator acts, and the coordinator
 * owns the decision to throw if recovery fails. Silent degradation is a bug.
 */
// ─── Types (re-exported from types.ts) ───────────────────────────────────────
export { ContextPressureLevel, ContextOverflowError, CheckpointError, ContextConfigError, } from "./types.js";
// ─── Store (re-exported from store.ts) ─────────────────────────────────────────
export { SessionStore, createStore, createSessionStore } from "./store.js";
// ─── Backends (re-exported from backends/index.ts) ────────────────────────────
export { SqliteVecBackend, getBackend } from "./backends/index.js";
// ─── Ingestion (re-exported from ingestion/index.ts) ─────────────────────────
export { isDoclingAvailable, convertDocument, resetDoclingAvailabilityCache, chunkMarkdown, createIngestionPipeline, initKnowledgeDir, scanKnowledgeDir, markIngested, resolveKnowledgeDir, } from "./ingestion/index.js";
//# sourceMappingURL=index.js.map