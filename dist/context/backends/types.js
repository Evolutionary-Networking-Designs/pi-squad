/**
 * @module context/backends/types
 * VectorBackend abstraction — defines the contract that both sqlite-vec (local)
 * and postgres pgvector (future state) must satisfy.
 *
 * Contract invariants:
 * - Vectors are always Float32Array(384) — all backends must preserve this dimension
 * - `score` in SearchResult is cosine similarity (0–1, higher = more similar)
 * - `metadata` is round-tripped as a JSON-serializable plain object
 * - `initialize()` must be called before any other method
 * - All methods return Promises for pgvector compat; sqlite-vec resolves immediately
 */
export {};
//# sourceMappingURL=types.js.map