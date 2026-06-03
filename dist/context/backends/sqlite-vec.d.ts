/**
 * @module context/backends/sqlite-vec
 * VectorBackend implementation backed by sqlite-vec (local, synchronous).
 *
 * Uses better-sqlite3 + the vec0 virtual table extension for cosine-similarity
 * vector search. All operations are synchronous internally; the Promise interface
 * exists for VectorBackend compliance (and pgvector compat).
 *
 * Two usage modes:
 * 1. Owned DB (manageSchema: true, default): backend creates its own virtual table
 *    and a companion metadata table. Used by the ingestion pipeline.
 * 2. Shared DB (manageSchema: false): backend wraps an externally-managed virtual
 *    table (e.g. the store.ts `vec_checkpoints` table). Used by SessionStore.
 */
import type { VectorBackend, SearchResult, SearchFilter } from "./types.js";
type SqliteDatabase = import("better-sqlite3").Database;
export interface SqliteVecBackendOptions {
    /**
     * An existing Database instance whose lifecycle is managed by the owner.
     * Mutually exclusive with `dbPath`.
     * When provided, the sqlite-vec extension is assumed already loaded.
     */
    db?: SqliteDatabase;
    /**
     * Path to a SQLite database file to open (or create).
     * Mutually exclusive with `db`.
     * The sqlite-vec extension will be loaded automatically.
     */
    dbPath?: string;
    /** Name of the vec0 virtual table (default: 'vec_embeddings') */
    tableName?: string;
    /**
     * Column name for the primary key in the virtual table.
     * Needed when wrapping an existing table that uses a non-standard column name.
     * Default: 'id'
     */
    primaryKeyColumn?: string;
    /**
     * Column name for the embedding in the virtual table.
     * Default: 'embedding'
     */
    embeddingColumn?: string;
    /** Embedding dimension (default: 384) */
    dimension?: number;
    /**
     * If true (default), `initialize()` creates the virtual table and a companion
     * metadata table `{tableName}_meta`. Set to false when the schema is managed
     * externally and the backend is only wrapping existing table operations.
     */
    manageSchema?: boolean;
}
export declare class SqliteVecBackend implements VectorBackend {
    private db;
    private readonly ownedDb;
    private readonly dbPath;
    private readonly tableName;
    private readonly pkCol;
    private readonly embedCol;
    private readonly dimension;
    private readonly manageSchema;
    private readonly metaTable;
    constructor(options: SqliteVecBackendOptions);
    initialize(): Promise<void>;
    close(): Promise<void>;
    saveEmbedding(id: string, vector: Float32Array, metadata?: Record<string, unknown>): Promise<void>;
    findSimilar(vector: Float32Array, topK: number, filter?: SearchFilter): Promise<SearchResult[]>;
    deleteEmbedding(id: string): Promise<void>;
    private assertDb;
}
export {};
//# sourceMappingURL=sqlite-vec.d.ts.map