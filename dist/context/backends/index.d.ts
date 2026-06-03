/**
 * @module context/backends
 * Factory and registry for VectorBackend implementations.
 *
 * Usage:
 * ```typescript
 * import { getBackend } from "./backends/index.js";
 *
 * const backend = await getBackend({ type: "sqlite-vec", dbPath: ".squad/knowledge.db" });
 * await backend.initialize();
 * ```
 *
 * Re-exports the VectorBackend interface and helpers so callers only need one import.
 */
export type { VectorBackend, SearchResult, SearchFilter, BackendConfig, SqliteVecConfig, PgVectorConfig, } from "./types.js";
export { SqliteVecBackend } from "./sqlite-vec.js";
export type { SqliteVecBackendOptions } from "./sqlite-vec.js";
export { PgVectorBackend } from "./pgvector.js";
import type { BackendConfig, VectorBackend } from "./types.js";
/**
 * Create and return the appropriate VectorBackend for the given config.
 * The returned backend is NOT yet initialized — call `backend.initialize()` before use.
 *
 * @param config Backend configuration (type discriminates sqlite-vec vs pgvector)
 * @returns Uninitialized VectorBackend instance
 */
export declare function getBackend(config: BackendConfig): Promise<VectorBackend>;
//# sourceMappingURL=index.d.ts.map