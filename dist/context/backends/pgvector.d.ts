/**
 * @module context/backends/pgvector
 * PostgreSQL pgvector-backed VectorBackend implementation.
 */
import type { PgVectorConfig, SearchFilter, SearchResult, VectorBackend } from "./types.js";
export declare class PgVectorBackend implements VectorBackend {
    private pool;
    private readonly connectionString;
    private readonly tableName;
    private readonly dimension;
    constructor(config: PgVectorConfig);
    initialize(): Promise<void>;
    close(): Promise<void>;
    saveEmbedding(id: string, vector: Float32Array, metadata?: Record<string, unknown>): Promise<void>;
    findSimilar(vector: Float32Array, topK: number, filter?: SearchFilter): Promise<SearchResult[]>;
    deleteEmbedding(id: string): Promise<void>;
    private assertPool;
}
//# sourceMappingURL=pgvector.d.ts.map