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

// ─── Search Types ──────────────────────────────────────────────────────────────

/** A single result from a vector similarity search, ordered most-similar first. */
export interface SearchResult {
  /** The stored embedding identifier */
  readonly id: string;

  /**
   * Cosine similarity score (0–1). Higher values are more similar.
   * Note: sqlite-vec reports distance (lower = closer); backends normalize to similarity.
   */
  readonly score: number;

  /** Arbitrary metadata stored alongside the embedding at save time. */
  readonly metadata: Record<string, unknown>;
}

/**
 * Optional metadata filter to narrow vector search results.
 * All specified key-value pairs must match (AND semantics).
 * For sqlite-vec, filtering is applied in-process after vector search.
 * For pgvector, this maps to a JSONB containment query.
 */
export type SearchFilter = Record<string, unknown>;

// ─── Backend Interface ─────────────────────────────────────────────────────────

/**
 * Backend-agnostic interface for vector embedding storage and retrieval.
 *
 * Both sqlite-vec (local) and pgvector (postgres) implement this interface.
 * All callers — store.ts, ingestion pipeline — are written against this interface only.
 * Swapping backends requires only a config change; no caller code changes.
 *
 * Embedding dimension is fixed at 384 (Xenova/all-MiniLM-L6-v2).
 */
export interface VectorBackend {
  /**
   * Initialize the backend — create tables and indexes as needed.
   * Must be called before any other method.
   * For sqlite-vec, this is synchronous internally and resolves immediately.
   * For pgvector, this may involve async DDL operations.
   */
  initialize(): Promise<void>;

  /**
   * Release backend resources.
   * For sqlite-vec with a shared db, this is a no-op (the db owner manages lifecycle).
   * For pgvector, this closes the connection pool.
   */
  close(): Promise<void>;

  /**
   * Upsert an embedding with associated metadata.
   * If an embedding with the same id already exists it is replaced atomically.
   *
   * @param id       Unique identifier for this embedding (opaque string key)
   * @param vector   384-dimensional Float32Array — must match the configured dimension
   * @param metadata Arbitrary JSON-serializable data; persisted and returned in search results
   */
  saveEmbedding(
    id: string,
    vector: Float32Array,
    metadata?: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Find the topK most similar embeddings to the given query vector.
   * Results are ordered by descending similarity (most similar first).
   *
   * @param vector  384-dimensional query Float32Array
   * @param topK    Maximum number of results to return
   * @param filter  Optional metadata filter (AND semantics); applied after vector search
   * @returns       Ranked results, most similar first
   */
  findSimilar(
    vector: Float32Array,
    topK: number,
    filter?: SearchFilter,
  ): Promise<SearchResult[]>;

  /**
   * Delete an embedding by ID. No-op if the ID does not exist.
   *
   * @param id Identifier to remove
   */
  deleteEmbedding(id: string): Promise<void>;
}

// ─── Backend Configuration ─────────────────────────────────────────────────────

/** Union of all supported backend configurations. */
export type BackendConfig = SqliteVecConfig | PgVectorConfig;

/** Configuration for the sqlite-vec backend (local, no server required). */
export interface SqliteVecConfig {
  readonly type: "sqlite-vec";

  /** Path to the SQLite database file, or ':memory:' for in-memory */
  readonly dbPath: string;

  /** Name for the virtual vec0 table (default: 'vec_embeddings') */
  readonly tableName?: string;

  /** Embedding dimension (default: 384) */
  readonly dimension?: number;
}

/**
 * Configuration for the pgvector backend.
 * See src/context/backends/PGVECTOR.md for migration guide.
 */
export interface PgVectorConfig {
  readonly type: "pgvector";

  /**
   * PostgreSQL connection string.
   * Recommended source: process.env.PISQUAD_PG_URL
   * Example: postgresql://user:pass@localhost:5432/pisquad
   */
  readonly connectionString: string;

  /** Name for the embeddings table (default: 'squad_embeddings') */
  readonly tableName?: string;

  /** Embedding dimension (default: 384) */
  readonly dimension?: number;
}
