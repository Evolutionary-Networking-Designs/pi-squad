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
export { SqliteVecBackend } from "./sqlite-vec.js";
export { PgVectorBackend } from "./pgvector.js";
import { SqliteVecBackend } from "./sqlite-vec.js";
/**
 * Create and return the appropriate VectorBackend for the given config.
 * The returned backend is NOT yet initialized — call `backend.initialize()` before use.
 *
 * @param config Backend configuration (type discriminates sqlite-vec vs pgvector)
 * @returns Uninitialized VectorBackend instance
 */
export async function getBackend(config) {
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
            return new PgVectorBackend(config);
        }
        default: {
            const _exhaustive = config;
            throw new Error(`Unknown backend type: ${JSON.stringify(_exhaustive)}`);
        }
    }
}
//# sourceMappingURL=index.js.map