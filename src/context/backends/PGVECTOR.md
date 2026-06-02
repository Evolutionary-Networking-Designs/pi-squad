# pgvector Backend — Future-State Migration Guide

**Status:** Implemented. `SqliteVecConfig` (`type: "sqlite-vec"`) remains the default
local backend, and `PgVectorConfig` (`type: "pgvector"`) is available for shared
PostgreSQL-backed deployments.

## When to Migrate

Migrate from sqlite-vec to pgvector when:
- Deploying in a **multi-user** environment where agents share a knowledge base
- Knowledge base exceeds **~100k chunks** (sqlite-vec performance degrades above this)
- You want **shared team knowledge** — one Postgres instance, many pi-squad clients
- CI/CD or remote dev environments where a local file path isn't persistent

## What Changes

Only the backend config changes. All caller code stays identical:

```typescript
// Before (local)
const backend = getBackend({ type: "sqlite-vec", dbPath: ".squad/knowledge.db" });

// After (shared)
const backend = getBackend({
  type: "pgvector",
  connectionString: process.env.PISQUAD_PG_URL!,
});
```

The embedding pipeline, ingestion pipeline, chunker, and knowledge-dir logic are
**completely unchanged**. The `VectorBackend` interface abstracts all of it.

## What Stays the Same

- Embedding pipeline: `@xenova/transformers`, `Xenova/all-MiniLM-L6-v2`, 384-dim
- Float32Array(384) interface contract — never changes across backends
- Ingestion pipeline: `convertDocument → chunkMarkdown → embed → saveEmbedding`
- Knowledge dir convention: `.squad/knowledge/`
- All `store.ts` checkpoint operations (still use sqlite-vec via shared DB)

## Connection Configuration

```bash
export PISQUAD_PG_URL=postgresql://user:password@host:5432/pisquad
```

## Target Schema

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS squad_embeddings (
  id         TEXT PRIMARY KEY,
  content    TEXT NOT NULL,
  embedding  vector(384),
  metadata   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS squad_embeddings_hnsw
  ON squad_embeddings
  USING hnsw (embedding vector_cosine_ops);
```

## Implementation Notes (when building)

- Use the `pg` npm package for Node.js connectivity (`Pool`, not `Client`)
- `findSimilar` query: `ORDER BY embedding <=> $1::vector LIMIT $2`
- Metadata filter: `WHERE metadata @> $n::jsonb`
- Cosine similarity: `1 - (embedding <=> $1::vector)` — pgvector `<=>` is cosine distance
- Connection pooling: use `pg.Pool` — one pool per backend instance
- `close()` must call `pool.end()`
