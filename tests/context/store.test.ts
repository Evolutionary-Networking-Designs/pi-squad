import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const fakeStatement = {
    get: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
  };
  const fakeDb = {
    pragma: vi.fn(),
    loadExtension: vi.fn(),
    exec: vi.fn(),
    prepare: vi.fn(() => fakeStatement),
    transaction: vi.fn((fn: () => void) => fn),
  };
  const vectorBackend = {
    initialize: vi.fn(async () => {}),
    deleteEmbedding: vi.fn(async () => {}),
    saveEmbedding: vi.fn(async () => {}),
    findSimilar: vi.fn(async () => []),
  };

  return {
    fakeDb,
    vectorBackend,
  };
});

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("better-sqlite3", () => ({
  default: vi.fn(function MockDatabase() {
    return mockState.fakeDb;
  }),
}));

vi.mock("sqlite-vec", () => ({
  getLoadablePath: vi.fn(() => "/mock/sqlite-vec"),
}));

vi.mock("@xenova/transformers", () => ({
  pipeline: vi.fn(),
  env: {},
}));

vi.mock("../../src/context/backends/sqlite-vec.js", () => ({
  SqliteVecBackend: vi.fn(function MockSqliteVecBackend() {
    return mockState.vectorBackend;
  }),
}));

import Database from "better-sqlite3";

import { createSessionStore, SessionStore } from "../../src/context/store.js";
import {
  ContextPressureLevel,
  type ContextCheckpoint,
  type TokenSample,
} from "../../src/context/types.js";

const mkdirSyncMock = vi.mocked(mkdirSync);
const readFileMock = vi.mocked(readFile);
const databaseMock = vi.mocked(Database);

function createMissingError(filePath: string): Error & { code: string } {
  const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as Error & {
    code: string;
  };
  error.code = "ENOENT";
  return error;
}

function createCheckpoint(
  overrides: Partial<
    ContextCheckpoint & {
      sessionId: string;
      sessionName: string;
      tokenSamples: readonly TokenSample[];
    }
  > = {},
): ContextCheckpoint & {
  sessionId: string;
  sessionName: string;
  tokenSamples: readonly TokenSample[];
} {
  return {
    id: "checkpoint-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    turnIndex: 5,
    triggerLevel: ContextPressureLevel.CRITICAL,
    budget: {
      total: 100,
      used: 95,
      available: 5,
      pressureLevel: ContextPressureLevel.CRITICAL,
      utilizationPercent: 95,
      measuredAt: "2026-06-01T00:00:00.000Z",
    },
    state: {
      activeAgents: ["Ada"],
      routingDigest: "digest",
      recentDecisionIds: ["decision-1"],
      activeWorkItems: [],
      historySummaries: [],
    },
    squadVersion: "0.9.4",
    checksum: "sha256:abc",
    sessionId: "session-1",
    sessionName: "Docs Session",
    tokenSamples: [
      {
        sessionId: "session-1",
        timestamp: "2026-06-01T00:00:00.000Z",
        tokens: 95,
        contextWindow: 100,
        percent: 95,
        pressureLevel: ContextPressureLevel.CRITICAL,
      },
    ],
    ...overrides,
  };
}

describe("context store", () => {
  beforeEach(() => {
    mkdirSyncMock.mockReset();
    readFileMock.mockReset();
    databaseMock.mockClear();
    mockState.fakeDb.pragma.mockReset();
    mockState.fakeDb.loadExtension.mockReset();
    mockState.fakeDb.exec.mockReset();
    mockState.fakeDb.prepare.mockClear();
    mockState.fakeDb.transaction.mockClear();
    mockState.vectorBackend.initialize.mockReset();
    mockState.vectorBackend.deleteEmbedding.mockReset();
    mockState.vectorBackend.saveEmbedding.mockReset();
    mockState.vectorBackend.findSimilar.mockReset();
  });

  it("createSessionStore returns an initialized SessionStore instance", async () => {
    readFileMock.mockRejectedValue(createMissingError("/repo/.squad/checkpoints/latest.json"));

    const store = await createSessionStore("/repo/.squad");

    expect(store).toBeInstanceOf(SessionStore);
    expect(databaseMock).toHaveBeenCalledWith("/repo/.squad/session.db");
    expect(mkdirSyncMock).toHaveBeenCalledWith("/repo/.squad", { recursive: true });
    expect(mockState.vectorBackend.initialize).toHaveBeenCalledTimes(1);
  });

  it("bootstrapFromCheckpoint restores session metadata and token samples", async () => {
    const store = new SessionStore(":memory:");
    const checkpoint = createCheckpoint();
    const upsertSessionSpy = vi.spyOn(store, "upsertSession");
    const touchSessionSpy = vi.spyOn(store, "touchSession");
    const recordTokenSampleSpy = vi.spyOn(store, "recordTokenSample");

    await store.bootstrapFromCheckpoint(checkpoint);

    expect(upsertSessionSpy).toHaveBeenCalledWith("session-1", "Docs Session");
    expect(touchSessionSpy).toHaveBeenCalledWith("session-1", ContextPressureLevel.CRITICAL);
    expect(recordTokenSampleSpy).toHaveBeenCalledWith(checkpoint.tokenSamples[0]);
  });

  it("createSessionStore bootstraps from checkpoints/latest.json when present", async () => {
    const checkpoint = createCheckpoint();
    const bootstrapSpy = vi
      .spyOn(SessionStore.prototype, "bootstrapFromCheckpoint")
      .mockResolvedValue();
    readFileMock.mockResolvedValue(JSON.stringify(checkpoint));

    await createSessionStore("/repo/.squad");

    expect(readFileMock).toHaveBeenCalledWith("/repo/.squad/checkpoints/latest.json", "utf8");
    expect(bootstrapSpy).toHaveBeenCalledWith(checkpoint);
    bootstrapSpy.mockRestore();
  });
});
