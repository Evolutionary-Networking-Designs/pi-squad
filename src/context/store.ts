/**
 * @module context/store
 * SQLite-backed session store for token analytics, checkpoints, and semantic recovery.
 *
 * Uses better-sqlite3 for synchronous local persistence and sqlite-vec for vector
 * search via the VectorBackend abstraction. Embeddings use @huggingface/transformers
 * (Xenova/all-MiniLM-L6-v2, 384-dim) for semantic similarity. The pipeline is
 * lazy-initialized on first use and cached.
 *
 * Vector operations are delegated to SqliteVecBackend (manageSchema: false) so
 * that the store owns the schema and the backend owns only the vec0 table operations.
 * Swapping to pgvector requires only changing the backend — all store logic stays.
 */

import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { pipeline, env } from "@huggingface/transformers";

import {
  ContextPressureLevel,
  type ContextCheckpoint,
  type TokenSample,
} from "./types.js";

import { SqliteVecBackend } from "./backends/sqlite-vec.js";
import type { BackendConfig, VectorBackend } from "./backends/types.js";

type SqliteDatabase = import("better-sqlite3").Database;

type PersistedCheckpointEnvelope = {
  checkpoint: ContextCheckpoint;
  sessionId: string;
  sessionName: string | null;
  summary: string;
};

type PersistedCheckpointRow = {
  id: string;
  session_id: string;
  session_name: string | null;
  timestamp: number;
  summary: string;
  embedding: Buffer | null;
  metadata: string | null;
};

type TokenSampleRow = {
  session_id: string;
  timestamp: number;
  tokens: number | null;
  context_window: number;
  percent: number | null;
  pressure_level: string;
};

type SessionRow = {
  id: string;
  name: string | null;
  created_at: number;
  last_active: number;
  token_high_watermark: number | null;
  peak_pressure_level: string | null;
  checkpoint_count: number;
};

export interface SessionEntry {
  readonly id: string;
  readonly name: string | null;
  readonly createdAt: string;
  readonly lastActive: string;
  readonly tokenHighWatermark: number | null;
  readonly peakPressureLevel: ContextPressureLevel | null;
  readonly checkpointCount: number;
}

type RuntimeCheckpointFields = {
  sessionId?: string;
  sessionName?: string;
  summary?: string;
};

type CheckpointBootstrap = ContextCheckpoint &
  RuntimeCheckpointFields & {
    tokenSamples?: readonly TokenSample[];
  };

// Force HuggingFace CDN download; never attempt to load from local filesystem path
env.allowLocalModels = false;

const DEFAULT_EMBEDDING_DIMENSION = 384;
const DEFAULT_RELEVANT_LIMIT = 5;
const DEFAULT_TREND_WINDOW_MS = 10 * 60_000;

// ─── Lazy Embedding Pipeline ──────────────────────────────────────────────────

type FeatureExtractionPipeline = Awaited<ReturnType<typeof pipeline>>;
let embeddingPipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (!embeddingPipelinePromise) {
    embeddingPipelinePromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return embeddingPipelinePromise;
}

async function getEmbedding(text: string): Promise<Float32Array> {
  const pipe = await getEmbeddingPipeline();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- transformers output shape varies
  const output = await (pipe as any)(text, { pooling: "mean", normalize: true });
  return new Float32Array(output.data as ArrayBuffer);
}
const PRESSURE_ORDER: Record<ContextPressureLevel, number> = {
  [ContextPressureLevel.NOMINAL]: 0,
  [ContextPressureLevel.WARNING]: 1,
  [ContextPressureLevel.CRITICAL]: 2,
  [ContextPressureLevel.OVERFLOW]: 3,
};

export class SessionStore {
  private readonly db: SqliteDatabase;
  private readonly dbPath: string;
  private readonly embeddingDimension: number;
  private readonly vectorBackend: VectorBackend;

  public constructor(storePath: string, backend?: BackendConfig) {
    const dbPath = resolveSessionDbPath(storePath, backend);

    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.dbPath = dbPath;
    this.embeddingDimension = DEFAULT_EMBEDDING_DIMENSION;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.loadExtension(sqliteVec.getLoadablePath());

    // vec_checkpoints schema is managed by initializeSchema() below.
    // The backend wraps the existing table (manageSchema: false) — it owns
    // only the insert/delete/query operations, not DDL.
    this.vectorBackend = new SqliteVecBackend({
      db: this.db,
      tableName: "vec_checkpoints",
      primaryKeyColumn: "checkpoint_id",
      embeddingColumn: "embedding",
      dimension: DEFAULT_EMBEDDING_DIMENSION,
      manageSchema: false,
    });

    this.initializeSchema();
  }

  public recordTokenSample(sample: TokenSample): void {
    const timestamp = toEpochMilliseconds(sample.timestamp);
    const sessionRow = this.db
      .prepare<{ id: string }, { id: string; name: string | null; created_at: number; last_active: number; token_high_watermark: number | null; peak_pressure_level: string | null }>(
        `SELECT id, name, created_at, last_active, token_high_watermark, peak_pressure_level
         FROM sessions
         WHERE id = @id`,
      )
      .get({ id: sample.sessionId });

    const nextPeakPressure = maxPressureLevel(
      toPressureLevel(sessionRow?.peak_pressure_level ?? null),
      sample.pressureLevel,
    );
    const nextHighWatermark =
      sample.tokens === null
        ? sessionRow?.token_high_watermark ?? null
        : Math.max(sessionRow?.token_high_watermark ?? 0, sample.tokens);

    const writeSample = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO token_samples (
             session_id,
             timestamp,
             tokens,
             context_window,
             percent,
             pressure_level
           ) VALUES (
             @session_id,
             @timestamp,
             @tokens,
             @context_window,
             @percent,
             @pressure_level
           )`,
        )
        .run({
          session_id: sample.sessionId,
          timestamp,
          tokens: sample.tokens,
          context_window: sample.contextWindow,
          percent: Number.isFinite(sample.percent) ? sample.percent : null,
          pressure_level: sample.pressureLevel,
        });

      this.db
        .prepare(
          `INSERT INTO sessions (
             id,
             name,
             created_at,
             last_active,
             token_high_watermark,
             peak_pressure_level
           ) VALUES (
             @id,
             @name,
             @created_at,
             @last_active,
             @token_high_watermark,
             @peak_pressure_level
           )
           ON CONFLICT(id) DO UPDATE SET
             name = COALESCE(sessions.name, excluded.name),
             last_active = excluded.last_active,
             token_high_watermark = excluded.token_high_watermark,
             peak_pressure_level = excluded.peak_pressure_level`,
        )
        .run({
          id: sample.sessionId,
          name: sessionRow?.name ?? null,
          created_at: sessionRow?.created_at ?? timestamp,
          last_active: timestamp,
          token_high_watermark: nextHighWatermark,
          peak_pressure_level: nextPeakPressure,
        });
    });

    writeSample();
  }

  public querySamples(sessionId: string, limit?: number): TokenSample[] {
    const rows =
      typeof limit === "number"
        ? this.db
            .prepare<{ sessionId: string; limit: number }, TokenSampleRow>(
              `SELECT session_id, timestamp, tokens, context_window, percent, pressure_level
               FROM (
                 SELECT session_id, timestamp, tokens, context_window, percent, pressure_level
                 FROM token_samples
                 WHERE session_id = @sessionId
                 ORDER BY timestamp DESC
                 LIMIT @limit
               ) recent
               ORDER BY timestamp ASC`,
            )
            .all({ sessionId, limit })
        : this.db
            .prepare<{ sessionId: string }, TokenSampleRow>(
              `SELECT session_id, timestamp, tokens, context_window, percent, pressure_level
               FROM token_samples
               WHERE session_id = @sessionId
               ORDER BY timestamp ASC`,
            )
            .all({ sessionId });

    return rows.map((row) => this.mapTokenSample(row));
  }

  public queryTrend(
    sessionId: string,
    windowSize = DEFAULT_TREND_WINDOW_MS,
  ): { avgPercent: number; peakPercent: number; sampleCount: number } {
    const latest = this.db
      .prepare<{ sessionId: string }, { timestamp: number }>(
        `SELECT timestamp
         FROM token_samples
         WHERE session_id = @sessionId
         ORDER BY timestamp DESC
         LIMIT 1`,
      )
      .get({ sessionId });

    if (!latest) {
      return { avgPercent: 0, peakPercent: 0, sampleCount: 0 };
    }

    const windowStart = latest.timestamp - windowSize;
    const trend = this.db
      .prepare<
        [{ sessionId: string; windowStart: number }],
        { avg_percent: number | null; peak_percent: number | null; sample_count: number }
      >(
        `SELECT
           AVG(percent) AS avg_percent,
           MAX(percent) AS peak_percent,
           COUNT(percent) AS sample_count
         FROM token_samples
         WHERE session_id = @sessionId
           AND timestamp >= @windowStart`,
      )
      .get({ sessionId, windowStart });

    return {
      avgPercent: trend?.avg_percent ?? 0,
      peakPercent: trend?.peak_percent ?? 0,
      sampleCount: trend?.sample_count ?? 0,
    };
  }

  public listSessions(): SessionEntry[] {
    const rows = this.db
      .prepare<[], SessionRow>(
        `SELECT
           s.id,
           s.name,
           s.created_at,
           s.last_active,
           s.token_high_watermark,
           s.peak_pressure_level,
           COUNT(c.id) AS checkpoint_count
         FROM sessions s
         LEFT JOIN checkpoints c ON c.session_id = s.id
         GROUP BY s.id, s.name, s.created_at, s.last_active, s.token_high_watermark, s.peak_pressure_level
         ORDER BY s.last_active DESC`,
      )
      .all();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: fromEpochMilliseconds(row.created_at),
      lastActive: fromEpochMilliseconds(row.last_active),
      tokenHighWatermark: row.token_high_watermark,
      peakPressureLevel: toPressureLevel(row.peak_pressure_level),
      checkpointCount: row.checkpoint_count,
    }));
  }

  public getLastKnownTokens(sessionId: string): number | null {
    const row = this.db
      .prepare<{ sessionId: string }, { tokens: number | null }>(
        `SELECT tokens
         FROM token_samples
         WHERE session_id = @sessionId
           AND tokens IS NOT NULL
         ORDER BY timestamp DESC
         LIMIT 1`,
      )
      .get({ sessionId });

    return row?.tokens ?? null;
  }

  public async saveCheckpoint(checkpoint: ContextCheckpoint, embedding?: Float32Array): Promise<void> {
    const runtime = checkpoint as ContextCheckpoint & RuntimeCheckpointFields;
    const activeSession = this.getMostRecentSession();
    const sessionId = runtime.sessionId ?? activeSession?.id ?? checkpoint.id;
    const sessionName = runtime.sessionName ?? activeSession?.name ?? null;
    const summary = runtime.summary ?? this.buildCheckpointSummary(checkpoint);
    const resolvedEmbedding = embedding ?? await getEmbedding(summary);
    const embeddingBlob = float32ArrayToBuffer(resolvedEmbedding);
    const metadata = JSON.stringify({
      checkpoint,
      sessionId,
      sessionName,
      summary,
    } satisfies PersistedCheckpointEnvelope);
    const timestamp = toEpochMilliseconds(checkpoint.createdAt);

    // Persist checkpoint metadata and session registry in a single SQL transaction.
    const persistMetadata = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO checkpoints (
             id,
             session_id,
             session_name,
             timestamp,
             summary,
             embedding,
             metadata
           ) VALUES (
             @id,
             @session_id,
             @session_name,
             @timestamp,
             @summary,
             @embedding,
             @metadata
           )
           ON CONFLICT(id) DO UPDATE SET
             session_id = excluded.session_id,
             session_name = excluded.session_name,
             timestamp = excluded.timestamp,
             summary = excluded.summary,
             embedding = excluded.embedding,
             metadata = excluded.metadata`,
        )
        .run({
          id: checkpoint.id,
          session_id: sessionId,
          session_name: sessionName,
          timestamp,
          summary,
          embedding: embeddingBlob,
          metadata,
        });

      this.writeSessionRegistry(sessionId, sessionName, timestamp, checkpoint.budget.used, checkpoint.triggerLevel);
    });
    persistMetadata();

    // Update vector index via backend — separate from SQL transaction since
    // vec0 virtual table operations are not composable with regular transactions.
    await this.vectorBackend.deleteEmbedding(checkpoint.id);
    await this.vectorBackend.saveEmbedding(checkpoint.id, resolvedEmbedding);
  }

  public async findRelevantCheckpoints(
    query: string,
    sessionId?: string,
    limit = DEFAULT_RELEVANT_LIMIT,
  ): Promise<ContextCheckpoint[]> {
    const queryEmbedding = await getEmbedding(query);
    // Fetch more candidates when filtering by sessionId so post-filter has enough hits
    const candidateLimit = sessionId ? Math.max(limit * 5, limit) : limit;

    const matches = await this.vectorBackend.findSimilar(queryEmbedding, candidateLimit);
    if (matches.length === 0) return [];

    // Fetch checkpoint metadata for matched IDs, preserving similarity order
    const matchIds = matches.map((m) => m.id);
    const placeholders = matchIds.map(() => "?").join(",");
    const queryArgs: (string | null)[] = [...matchIds];
    const sessionFilter = sessionId ? "AND c.session_id = ?" : "";
    if (sessionId) queryArgs.push(sessionId);

    const rows = this.db
      .prepare<unknown[], PersistedCheckpointRow>(
        `SELECT id, session_id, session_name, timestamp, summary, embedding, metadata
         FROM checkpoints c
         WHERE c.id IN (${placeholders}) ${sessionFilter}`,
      )
      .all(queryArgs) as PersistedCheckpointRow[];

    const rowMap = new Map(rows.map((row) => [row.id, row]));

    return matchIds
      .filter((id) => rowMap.has(id))
      .slice(0, limit)
      .map((id) => this.decodeCheckpoint(rowMap.get(id)!))
      .filter((cp): cp is ContextCheckpoint => cp !== null);
  }

  public getCheckpoint(id: string): ContextCheckpoint | null {
    const row = this.db
      .prepare<{ id: string }, PersistedCheckpointRow>(
        `SELECT id, session_id, session_name, timestamp, summary, embedding, metadata
         FROM checkpoints
         WHERE id = @id`,
      )
      .get({ id });

    return row ? this.decodeCheckpoint(row) : null;
  }

  public listCheckpoints(sessionId: string): ContextCheckpoint[] {
    const rows = this.db
      .prepare<{ sessionId: string }, PersistedCheckpointRow>(
        `SELECT id, session_id, session_name, timestamp, summary, embedding, metadata
         FROM checkpoints
         WHERE session_id = @sessionId
         ORDER BY timestamp DESC`,
      )
      .all({ sessionId });

    return rows
      .map((row) => this.decodeCheckpoint(row))
      .filter((checkpoint): checkpoint is ContextCheckpoint => checkpoint !== null);
  }

  public async initialize(): Promise<void> {
    await this.vectorBackend.initialize();
  }

  public async bootstrapFromCheckpoint(checkpoint: ContextCheckpoint): Promise<void> {
    const bootstrappedCheckpoint = checkpoint as CheckpointBootstrap;

    if (bootstrappedCheckpoint.sessionId) {
      this.upsertSession(
        bootstrappedCheckpoint.sessionId,
        bootstrappedCheckpoint.sessionName,
      );
      this.touchSession(
        bootstrappedCheckpoint.sessionId,
        checkpoint.triggerLevel,
      );
    }

    for (const sample of bootstrappedCheckpoint.tokenSamples ?? []) {
      this.recordTokenSample(sample);
    }
  }

  public upsertSession(id: string, name?: string): void {
    const now = Date.now();
    const existing = this.db
      .prepare<{ id: string }, { created_at: number; token_high_watermark: number | null; peak_pressure_level: string | null }>(
        `SELECT created_at, token_high_watermark, peak_pressure_level
         FROM sessions
         WHERE id = @id`,
      )
      .get({ id });

    this.db
      .prepare(
        `INSERT INTO sessions (
           id,
           name,
           created_at,
           last_active,
           token_high_watermark,
           peak_pressure_level
         ) VALUES (
           @id,
           @name,
           @created_at,
           @last_active,
           @token_high_watermark,
           @peak_pressure_level
         )
         ON CONFLICT(id) DO UPDATE SET
           name = COALESCE(excluded.name, sessions.name),
           last_active = excluded.last_active`,
      )
      .run({
        id,
        name: name ?? null,
        created_at: existing?.created_at ?? now,
        last_active: now,
        token_high_watermark: existing?.token_high_watermark ?? null,
        peak_pressure_level: existing?.peak_pressure_level ?? null,
      });
  }

  public touchSession(id: string, pressureLevel?: ContextPressureLevel): void {
    const now = Date.now();
    const existing = this.db
      .prepare<{ id: string }, { name: string | null; created_at: number; token_high_watermark: number | null; peak_pressure_level: string | null }>(
        `SELECT name, created_at, token_high_watermark, peak_pressure_level
         FROM sessions
         WHERE id = @id`,
      )
      .get({ id });

    this.db
      .prepare(
        `INSERT INTO sessions (
           id,
           name,
           created_at,
           last_active,
           token_high_watermark,
           peak_pressure_level
         ) VALUES (
           @id,
           @name,
           @created_at,
           @last_active,
           @token_high_watermark,
           @peak_pressure_level
         )
         ON CONFLICT(id) DO UPDATE SET
           last_active = excluded.last_active,
           peak_pressure_level = excluded.peak_pressure_level`,
      )
      .run({
        id,
        name: existing?.name ?? null,
        created_at: existing?.created_at ?? now,
        last_active: now,
        token_high_watermark: existing?.token_high_watermark ?? null,
        peak_pressure_level: maxPressureLevel(
          toPressureLevel(existing?.peak_pressure_level ?? null),
          pressureLevel ?? ContextPressureLevel.NOMINAL,
        ),
      });
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS token_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tokens INTEGER,
        context_window INTEGER NOT NULL,
        percent REAL,
        pressure_level TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_token_samples_session
        ON token_samples(session_id, timestamp);

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        session_name TEXT,
        timestamp INTEGER NOT NULL,
        summary TEXT NOT NULL,
        embedding BLOB,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_checkpoints_session
        ON checkpoints(session_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT,
        created_at INTEGER NOT NULL,
        last_active INTEGER NOT NULL,
        token_high_watermark INTEGER,
        peak_pressure_level TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_last_active
        ON sessions(last_active DESC);
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_checkpoints USING vec0(
        checkpoint_id TEXT PRIMARY KEY,
        embedding FLOAT[${this.embeddingDimension}] DISTANCE_METRIC=cosine
      );
    `);
  }

  private mapTokenSample(row: TokenSampleRow): TokenSample {
    return {
      sessionId: row.session_id,
      timestamp: fromEpochMilliseconds(row.timestamp),
      tokens: row.tokens,
      contextWindow: row.context_window,
      percent: row.percent ?? 0,
      pressureLevel: toPressureLevel(row.pressure_level) ?? ContextPressureLevel.NOMINAL,
    };
  }

  private getMostRecentSession(): { id: string; name: string | null } | null {
    return (
      this.db
        .prepare<[], { id: string; name: string | null }>(
          `SELECT id, name
           FROM sessions
           ORDER BY last_active DESC
           LIMIT 1`,
        )
        .get() ?? null
    );
  }

  private decodeCheckpoint(row: PersistedCheckpointRow): ContextCheckpoint | null {
    if (!row.metadata) {
      return null;
    }

    try {
      const parsed = JSON.parse(row.metadata) as Partial<PersistedCheckpointEnvelope>;
      return parsed.checkpoint ?? null;
    } catch {
      return null;
    }
  }

  private buildCheckpointSummary(checkpoint: ContextCheckpoint): string {
    const activeAgents = checkpoint.state.activeAgents.join(", ") || "none";
    const workItems = checkpoint.state.activeWorkItems
      .map((item) => `${item.agent}: ${item.description}`)
      .join("; ");
    const recentDecisions = checkpoint.state.recentDecisionIds.join(", ") || "none";

    return [
      `Checkpoint ${checkpoint.id} captured at turn ${checkpoint.turnIndex}.`,
      `Pressure ${checkpoint.triggerLevel} at ${checkpoint.budget.utilizationPercent.toFixed(1)}% utilization.`,
      `Active agents: ${activeAgents}.`,
      `Recent decisions: ${recentDecisions}.`,
      workItems ? `Active work: ${workItems}.` : "No active work items.",
      checkpoint.state.historySummaries.length > 0
        ? `History summaries available for ${checkpoint.state.historySummaries.length} agent timelines.`
        : "No history summaries were captured.",
    ].join(" ");
  }

  private writeSessionRegistry(
    id: string,
    name: string | null,
    timestamp: number,
    tokenHighWatermark: number | null,
    pressureLevel: ContextPressureLevel,
  ): void {
    const existing = this.db
      .prepare<{ id: string }, { created_at: number; token_high_watermark: number | null; peak_pressure_level: string | null }>(
        `SELECT created_at, token_high_watermark, peak_pressure_level
         FROM sessions
         WHERE id = @id`,
      )
      .get({ id });

    this.db
      .prepare(
        `INSERT INTO sessions (
           id,
           name,
           created_at,
           last_active,
           token_high_watermark,
           peak_pressure_level
         ) VALUES (
           @id,
           @name,
           @created_at,
           @last_active,
           @token_high_watermark,
           @peak_pressure_level
         )
         ON CONFLICT(id) DO UPDATE SET
           name = COALESCE(excluded.name, sessions.name),
           last_active = excluded.last_active,
           token_high_watermark = excluded.token_high_watermark,
           peak_pressure_level = excluded.peak_pressure_level`,
      )
      .run({
        id,
        name,
        created_at: existing?.created_at ?? timestamp,
        last_active: timestamp,
        token_high_watermark:
          tokenHighWatermark === null
            ? existing?.token_high_watermark ?? null
            : Math.max(existing?.token_high_watermark ?? 0, tokenHighWatermark),
        peak_pressure_level: maxPressureLevel(
          toPressureLevel(existing?.peak_pressure_level ?? null),
          pressureLevel,
        ),
      });
  }
}

export function createStore(dbPath: string): SessionStore {
  return new SessionStore(dbPath);
}

/** Factory type — creates a SessionStore for a given squad directory */
export type StoreFactory = (squadPath: string, backend?: BackendConfig) => Promise<SessionStore>;

/**
 * Creates and initializes a SessionStore for the given squad directory.
 * If a JSON checkpoint exists at {squadPath}/checkpoints/latest.json, bootstraps from it.
 */
async function createSessionStoreImpl(
  squadPath: string,
  backend?: BackendConfig,
): Promise<SessionStore> {
  const store = new SessionStore(squadPath, backend);
  await store.initialize();

  const latestCheckpointPath = join(squadPath, "checkpoints", "latest.json");

  try {
    const rawCheckpoint = await readFile(latestCheckpointPath, "utf8");
    const checkpoint = JSON.parse(rawCheckpoint) as ContextCheckpoint;
    await store.bootstrapFromCheckpoint(checkpoint);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  return store;
}

export { createSessionStoreImpl as createSessionStore };

function resolveSessionDbPath(storePath: string, backend?: BackendConfig): string {
  if (backend?.type === "sqlite-vec") {
    return backend.dbPath;
  }

  if (storePath === ":memory:" || storePath.endsWith(".db")) {
    return storePath;
  }

  return join(storePath, "session.db");
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function toEpochMilliseconds(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed;
}

function fromEpochMilliseconds(value: number): string {
  return new Date(value).toISOString();
}

function toPressureLevel(value: string | null): ContextPressureLevel | null {
  if (!value) {
    return null;
  }

  switch (value) {
    case ContextPressureLevel.NOMINAL:
    case ContextPressureLevel.WARNING:
    case ContextPressureLevel.CRITICAL:
    case ContextPressureLevel.OVERFLOW:
      return value;
    default:
      return null;
  }
}

function maxPressureLevel(
  left: ContextPressureLevel | null,
  right: ContextPressureLevel,
): ContextPressureLevel {
  if (!left) {
    return right;
  }
  return PRESSURE_ORDER[right] > PRESSURE_ORDER[left] ? right : left;
}

function float32ArrayToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}
