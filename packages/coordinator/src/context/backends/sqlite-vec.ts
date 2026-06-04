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

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

import type { VectorBackend, SearchResult, SearchFilter } from "./types.js";

type SqliteDatabase = import("better-sqlite3").Database;

const DEFAULT_DIMENSION = 384;
const DEFAULT_TABLE_NAME = "vec_embeddings";

// ─── Options ──────────────────────────────────────────────────────────────────

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

// ─── Implementation ────────────────────────────────────────────────────────────

export class SqliteVecBackend implements VectorBackend {
  private db: SqliteDatabase | null = null;
  private readonly ownedDb: boolean;
  private readonly dbPath: string | undefined;
  private readonly tableName: string;
  private readonly pkCol: string;
  private readonly embedCol: string;
  private readonly dimension: number;
  private readonly manageSchema: boolean;
  private readonly metaTable: string;

  constructor(options: SqliteVecBackendOptions) {
    if (!options.db && !options.dbPath) {
      throw new Error("SqliteVecBackend: either `db` or `dbPath` must be provided");
    }
    if (options.db && options.dbPath) {
      throw new Error("SqliteVecBackend: `db` and `dbPath` are mutually exclusive");
    }

    if (options.db) {
      this.db = options.db;
      this.ownedDb = false;
    } else {
      this.dbPath = options.dbPath;
      this.ownedDb = true;
    }

    this.tableName = options.tableName ?? DEFAULT_TABLE_NAME;
    this.pkCol = options.primaryKeyColumn ?? "id";
    this.embedCol = options.embeddingColumn ?? "embedding";
    this.dimension = options.dimension ?? DEFAULT_DIMENSION;
    this.manageSchema = options.manageSchema ?? true;
    this.metaTable = `${this.tableName}_meta`;
  }

  initialize(): Promise<void> {
    if (this.ownedDb && this.dbPath) {
      if (this.dbPath !== ":memory:") {
        mkdirSync(dirname(this.dbPath), { recursive: true });
      }
      const db = new Database(this.dbPath);
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");
      db.pragma("foreign_keys = ON");
      db.pragma("busy_timeout = 5000");
      db.loadExtension(sqliteVec.getLoadablePath());
      this.db = db;
    }

    if (this.manageSchema) {
      this.assertDb();
      this.db!.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS "${this.tableName}" USING vec0(
          "${this.pkCol}" TEXT PRIMARY KEY,
          "${this.embedCol}" FLOAT[${this.dimension}] DISTANCE_METRIC=cosine
        );

        CREATE TABLE IF NOT EXISTS "${this.metaTable}" (
          id TEXT PRIMARY KEY,
          metadata TEXT NOT NULL DEFAULT '{}'
        );
      `);
    }

    return Promise.resolve();
  }

  close(): Promise<void> {
    if (this.ownedDb && this.db) {
      this.db.close();
      this.db = null;
    }
    return Promise.resolve();
  }

  saveEmbedding(
    id: string,
    vector: Float32Array,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.assertDb();
    const db = this.db!;
    const blob = float32ArrayToBuffer(vector);

    db.prepare(`DELETE FROM "${this.tableName}" WHERE "${this.pkCol}" = ?`).run(id);
    db.prepare(
      `INSERT INTO "${this.tableName}" ("${this.pkCol}", "${this.embedCol}") VALUES (?, ?)`,
    ).run(id, blob);

    if (this.manageSchema) {
      db.prepare(
        `INSERT INTO "${this.metaTable}" (id, metadata)
         VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET metadata = excluded.metadata`,
      ).run(id, JSON.stringify(metadata ?? {}));
    }

    return Promise.resolve();
  }

  findSimilar(
    vector: Float32Array,
    topK: number,
    filter?: SearchFilter,
  ): Promise<SearchResult[]> {
    this.assertDb();
    const db = this.db!;
    const queryJson = vectorToJson(vector);

    let results: SearchResult[];

    if (this.manageSchema) {
      const rows = db
        .prepare<[string, number], { id: string; distance: number; metadata: string }>(
          `SELECT v."${this.pkCol}" AS id, v.distance, COALESCE(m.metadata, '{}') AS metadata
           FROM (
             SELECT "${this.pkCol}", distance
             FROM "${this.tableName}"
             WHERE "${this.embedCol}" MATCH ?
             ORDER BY distance
             LIMIT ?
           ) v
           LEFT JOIN "${this.metaTable}" m ON m.id = v."${this.pkCol}"`,
        )
        .all(queryJson, topK);

      results = rows
        .filter((row) => {
          if (!filter) return true;
          try {
            const meta = JSON.parse(row.metadata) as Record<string, unknown>;
            return Object.entries(filter).every(([k, v]) => meta[k] === v);
          } catch {
            return false;
          }
        })
        .map((row) => ({
          id: row.id,
          score: 1 - row.distance,
          metadata: parseMetadata(row.metadata),
        }));
    } else {
      const rows = db
        .prepare<[string, number], { id: string; distance: number }>(
          `SELECT "${this.pkCol}" AS id, distance
           FROM "${this.tableName}"
           WHERE "${this.embedCol}" MATCH ?
           ORDER BY distance
           LIMIT ?`,
        )
        .all(queryJson, topK);

      results = rows.map((row) => ({
        id: row.id,
        score: 1 - row.distance,
        metadata: {},
      }));
    }

    return Promise.resolve(results);
  }

  deleteEmbedding(id: string): Promise<void> {
    this.assertDb();
    const db = this.db!;

    db.prepare(`DELETE FROM "${this.tableName}" WHERE "${this.pkCol}" = ?`).run(id);
    if (this.manageSchema) {
      db.prepare(`DELETE FROM "${this.metaTable}" WHERE id = ?`).run(id);
    }

    return Promise.resolve();
  }

  private assertDb(): void {
    if (!this.db) {
      throw new Error(
        "SqliteVecBackend: initialize() must be called before using the backend",
      );
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function float32ArrayToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function vectorToJson(vector: Float32Array): string {
  return JSON.stringify(Array.from(vector, (v) => Number(v.toFixed(6))));
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
