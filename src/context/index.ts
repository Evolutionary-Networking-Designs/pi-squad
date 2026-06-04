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

export {
  ContextPressureLevel,
  ContextOverflowError,
  CheckpointError,
  ContextConfigError,
} from "./types.js";

export type {
  ContextBudget,
  ContextMonitorConfig,
  TokenEstimator,
  ContextEvent,
  ContextPressureEvent,
  ContextOverflowEvent,
  ContextRecoveryEvent,
  AnyContextEvent,
  RecoveryContext,
  RecoveryResult,
  RecoveryAttempt,
  ContextCheckpoint,
  CoordinatorStateSnapshot,
  WorkItemRef,
  HistorySummary,
  TokenSample,
  TokenAnalytics,
} from "./types.js";

// ─── Monitor (re-exported from monitor.ts) ───────────────────────────────────

export type {
  ContextMonitor,
  ContextEventListener,
  ContextAssessment,
  CharApproxEstimator,
  PiNativeEstimator,
  CreateTokenEstimator,
  CreateContextMonitor,
  CreateDefaultConfig,
  AssessContext,
} from "./monitor.js";

// ─── Recovery (re-exported from recovery.ts) ──────────────────────────────────

export {
  DefaultRecoveryOrchestrator,
  DefaultCheckpointStrategy,
  DefaultGracefulDegradeStrategy,
  DefaultSummarizeStrategy,
  DefaultEscalateStrategy,
  createRecoveryOrchestrator,
} from "./recovery.js";

export type {
  RecoveryStrategy,
  RecoveryOrchestrator,
  SummarizeStrategy,
  SummarizeStrategyConfig,
  CheckpointStrategy,
  CheckpointStrategyConfig,
  GracefulDegradeStrategy,
  GracefulDegradeStrategyConfig,
  EscalateStrategy,
  CreateRecoveryOrchestrator,
  CreateSummarizeStrategy,
  CreateCheckpointStrategy,
  CreateGracefulDegradeStrategy,
  CreateEscalateStrategy,
} from "./recovery.js";

// ─── Store (re-exported from store.ts) ─────────────────────────────────────────

export { SessionStore, createStore, createSessionStore } from "./store.js";
export type { SessionEntry, StoreFactory } from "./store.js";

// ─── Backends (re-exported from backends/index.ts) ────────────────────────────

export { SqliteVecBackend, getBackend } from "./backends/index.js";
export type {
  VectorBackend,
  SearchResult,
  SearchFilter,
  BackendConfig,
  SqliteVecConfig,
  PgVectorConfig,
  SqliteVecBackendOptions,
} from "./backends/index.js";

// ─── Ingestion (re-exported from ingestion/index.ts) ─────────────────────────

export {
  isDoclingAvailable,
  convertDocument,
  resetDoclingAvailabilityCache,
  chunkMarkdown,
  createIngestionPipeline,
  initKnowledgeDir,
  scanKnowledgeDir,
  markIngested,
  resolveKnowledgeDir,
} from "./ingestion/index.js";

export type {
  DocMetadata,
  IngestResult,
  IngestFileResult,
  ChunkOptions,
  IngestProgressCallback,
  IngestionPipeline,
} from "./ingestion/index.js";
