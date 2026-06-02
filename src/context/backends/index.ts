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

export type {
  VectorBackend,
  SearchResult,
  SearchFilter,
  BackendConfig,
  SqliteVecConfig,
  PgVectorConfig,
} from "./types.js";

export { SqliteVecBackend } from "./sqlite-vec.js";
export type { SqliteVecBackendOptions } from "./sqlite-vec.js";
export { PgVectorBackend } from "./pgvector.js";

import { SqliteVecBackend } from "./sqlite-vec.js";
import type { BackendConfig, PgVectorConfig, VectorBackend } from "./types.js";

/**
 * Create and return the appropriate VectorBackend for the given config.
 * The returned backend is NOT yet initialized — call `backend.initialize()` before use.
 *
 * @param config Backend configuration (type discriminates sqlite-vec vs pgvector)
 * @returns Uninitialized VectorBackend instance
 */
export async function getBackend(config: BackendConfig): Promise<VectorBackend> {
  switch (config.type) {
    case "sqlite-vec":
      return new SqliteVecBackend({
        dbPath: config.dbPath,
        tableName: config.tableName,
        dimension: config.dimension,
        manageSchema: true,
      });

    case "pgvector": {
      const { PgVectorBackend } = await import("./pgvector.js");
      return new PgVectorBackend(config as PgVectorConfig);
    }

    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown backend type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
