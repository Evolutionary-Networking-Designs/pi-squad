/**
 * @module context/backends/pgvector
 * PostgreSQL pgvector-backed VectorBackend implementation.
 */
const DEFAULT_DIMENSION = 384;
const DEFAULT_TABLE_NAME = "squad_embeddings";
export class PgVectorBackend {
    pool = null;
    connectionString;
    tableName;
    dimension;
    constructor(config) {
        this.connectionString = config.connectionString;
        this.tableName = config.tableName ?? DEFAULT_TABLE_NAME;
        this.dimension = config.dimension ?? DEFAULT_DIMENSION;
    }
    async initialize() {
        if (this.pool) {
            return;
        }
        if (!this.connectionString) {
            throw new Error("PgVectorBackend requires a PostgreSQL connection string. Set PISQUAD_PG_URL and pass it as PgVectorConfig.connectionString.");
        }
        this.pool = await createPool(this.connectionString);
        const tableName = quoteIdent(this.tableName);
        const indexName = quoteIdent(`${this.tableName}_hnsw`);
        try {
            await this.pool.query("CREATE EXTENSION IF NOT EXISTS vector");
            await this.pool.query(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          embedding vector(${this.dimension}),
          metadata JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
            await this.pool.query(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} USING hnsw (embedding vector_cosine_ops)`);
        }
        catch (error) {
            await this.close();
            throw wrapPgError(error, "PgVectorBackend failed to initialize pgvector. Verify PISQUAD_PG_URL points to a PostgreSQL database with the pgvector extension available.");
        }
    }
    async close() {
        if (!this.pool) {
            return;
        }
        const pool = this.pool;
        this.pool = null;
        await pool.end();
    }
    async saveEmbedding(id, vector, metadata) {
        const pool = this.assertPool();
        assertDimension(vector, this.dimension);
        await pool.query(`INSERT INTO ${quoteIdent(this.tableName)} (id, content, embedding, metadata)
       VALUES ($1, $2, $3::vector, $4::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         content = EXCLUDED.content,
         embedding = EXCLUDED.embedding,
         metadata = EXCLUDED.metadata`, [id, resolveContent(metadata), toPgVector(vector), JSON.stringify(metadata ?? {})]);
    }
    async findSimilar(vector, topK, filter) {
        const pool = this.assertPool();
        assertDimension(vector, this.dimension);
        if (topK <= 0) {
            return [];
        }
        const params = [toPgVector(vector)];
        const whereClauses = [];
        if (filter && Object.keys(filter).length > 0) {
            params.push(JSON.stringify(filter));
            whereClauses.push(`metadata @> $${params.length}::jsonb`);
        }
        params.push(Math.floor(topK));
        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
        const result = await pool.query(`SELECT id, metadata, (embedding <=> $1::vector) AS distance
       FROM ${quoteIdent(this.tableName)}
       ${whereClause}
       ORDER BY embedding <=> $1::vector
       LIMIT $${params.length}`, params);
        return result.rows.map((row) => ({
            id: row.id,
            score: clampSimilarity(1 - row.distance),
            metadata: parseMetadata(row.metadata),
        }));
    }
    async deleteEmbedding(id) {
        const pool = this.assertPool();
        await pool.query(`DELETE FROM ${quoteIdent(this.tableName)} WHERE id = $1`, [id]);
    }
    assertPool() {
        if (!this.pool) {
            throw new Error("PgVectorBackend: initialize() must be called before using the backend. Set PISQUAD_PG_URL and initialize the backend first.");
        }
        return this.pool;
    }
}
async function createPool(connectionString) {
    try {
        const { Pool } = await import("pg");
        return new Pool({ connectionString });
    }
    catch (error) {
        throw wrapPgError(error, 'PgVectorBackend could not load the "pg" module. Install pg, then set PISQUAD_PG_URL to your PostgreSQL connection string.');
    }
}
function assertDimension(vector, expected) {
    if (vector.length !== expected) {
        throw new Error(`PgVectorBackend expected an embedding of length ${expected}, received ${vector.length}.`);
    }
}
function toPgVector(vector) {
    return `[${Array.from(vector, (value) => Number(value.toFixed(6))).join(",")}]`;
}
function resolveContent(metadata) {
    const candidates = [
        metadata?.content,
        metadata?.text,
        metadata?.chunk,
        metadata?.chunkText,
        metadata?.summary,
        metadata?.title,
        metadata?.sourcePath,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim().length > 0) {
            return candidate;
        }
    }
    return "";
}
function parseMetadata(metadata) {
    if (!metadata) {
        return {};
    }
    if (typeof metadata === "string") {
        try {
            return JSON.parse(metadata);
        }
        catch {
            return {};
        }
    }
    if (typeof metadata === "object" && !Array.isArray(metadata)) {
        return metadata;
    }
    return {};
}
function clampSimilarity(score) {
    return Math.max(0, Math.min(1, score));
}
function quoteIdent(identifier) {
    return `"${identifier.replaceAll('"', '""')}"`;
}
function wrapPgError(error, message) {
    const detail = error instanceof Error ? error.message : String(error);
    return new Error(`${message} ${detail}`);
}
//# sourceMappingURL=pgvector.js.map