import { mkdirSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const statements = {
    run: vi.fn(),
    all: vi.fn(),
  };
  const db = {
    pragma: vi.fn(),
    loadExtension: vi.fn(),
    exec: vi.fn(),
    prepare: vi.fn(() => statements),
    close: vi.fn(),
  };

  return { db, statements };
});

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
}));

vi.mock("better-sqlite3", () => ({
  default: vi.fn(function MockDatabase() {
    return mockState.db;
  }),
}));

vi.mock("sqlite-vec", () => ({
  getLoadablePath: vi.fn(() => "/mock/sqlite-vec"),
}));

import Database from "better-sqlite3";
import { getBackend, SqliteVecBackend } from "../../src/context/backends/index.js";

const mkdirSyncMock = vi.mocked(mkdirSync);
const databaseMock = vi.mocked(Database);

describe("context backends", () => {
  beforeEach(() => {
    mkdirSyncMock.mockReset();
    databaseMock.mockClear();
    mockState.db.pragma.mockReset();
    mockState.db.loadExtension.mockReset();
    mockState.db.exec.mockReset();
    mockState.db.prepare.mockClear();
    mockState.db.close.mockReset();
    mockState.statements.run.mockReset();
    mockState.statements.all.mockReset();
  });

  it("creates a sqlite-vec backend from the factory", async () => {
    const backend = await getBackend({
      type: "sqlite-vec",
      dbPath: "/repo/.squad/knowledge.db",
      tableName: "vec_docs",
      dimension: 8,
    });

    expect(backend).toBeInstanceOf(SqliteVecBackend);
  });

  it("initializes the sqlite-vec backend and creates schema", async () => {
    const backend = new SqliteVecBackend({
      dbPath: "/repo/.squad/knowledge.db",
      tableName: "vec_docs",
      dimension: 8,
    });

    await backend.initialize();

    expect(mkdirSyncMock).toHaveBeenCalledWith("/repo/.squad", { recursive: true });
    expect(databaseMock).toHaveBeenCalledWith("/repo/.squad/knowledge.db");
    expect(mockState.db.loadExtension).toHaveBeenCalled();
    expect(mockState.db.exec).toHaveBeenCalledWith(expect.stringContaining("CREATE VIRTUAL TABLE IF NOT EXISTS \"vec_docs\" USING vec0"));
  });
});
