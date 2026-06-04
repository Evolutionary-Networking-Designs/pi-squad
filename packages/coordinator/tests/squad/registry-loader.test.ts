import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
}));

import { readFile, rename, writeFile } from "node:fs/promises";
import {
  loadRegistryEntries,
  RegistryLoadError,
} from "../../src/squad/registry-loader.js";
import type { RegistryEntry } from "../../src/squad/registry-loader.js";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function mockContent(content: string): void {
  vi.mocked(readFile).mockResolvedValue(content as unknown as Buffer);
}

function mockEnoent(): void {
  vi.mocked(readFile).mockRejectedValue(
    Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" }),
  );
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_REGISTRY_JSON = JSON.stringify({
  version: "1",
  entries: [
    {
      persistentName: "Motoko",
      role: "lead",
      universe: "ghost-in-the-shell",
      createdAt: "2026-06-01T00:00:00.000Z",
      legacyNamed: false,
      status: "active",
      agentRole: "lead",
      piBuiltin: "planner",
    },
    {
      persistentName: "Batou",
      role: "developer",
      universe: "ghost-in-the-shell",
      createdAt: "2026-06-01T00:00:00.000Z",
      legacyNamed: false,
      status: "active",
      agentRole: "developer",
      piBuiltin: "worker",
    },
    {
      persistentName: "Togusa",
      role: "tester",
      universe: "ghost-in-the-shell",
      createdAt: "2026-06-01T00:00:00.000Z",
      legacyNamed: false,
      status: "active",
      agentRole: "tester",
      piBuiltin: "reviewer",
    },
  ],
});

const LEGACY_FIELDS_REGISTRY_JSON = JSON.stringify({
  version: "1",
  universe: "ghost-in-the-shell",
  entries: [
    {
      persistentName: "Togusa",
      role: "QA",
      universe: "ghost-in-the-shell",
      createdAt: "2026-06-01T00:00:00.000Z",
      legacyNamed: false,
      status: "active",
      customField: "keep-me",
    },
  ],
});

const LEGACY_REGISTRY_JSON = JSON.stringify({
  agents: {
    Motoko: {
      role: "lead",
      universe: "ghost-in-the-shell",
      assigned_at: "2026-06-01T00:00:00.000Z",
    },
  },
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("loadRegistryEntries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(rename).mockResolvedValue(undefined);
  });

  it("happy path: parses a valid registry and returns RegistryEntry[]", async () => {
    mockContent(VALID_REGISTRY_JSON);
    const entries = await loadRegistryEntries("/project");

    expect(entries).toHaveLength(3);

    const motoko = entries.find((e) => e.persistentName === "Motoko") as RegistryEntry;
    expect(motoko).toBeDefined();
    expect(motoko.agentRole).toBe("lead");
    expect(motoko.piBuiltin).toBe("planner");
    expect(motoko.status).toBe("active");

    const batou = entries.find((e) => e.persistentName === "Batou") as RegistryEntry;
    expect(batou).toBeDefined();
    expect(batou.agentRole).toBe("developer");
    expect(batou.piBuiltin).toBe("worker");

    expect(writeFile).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it("entries missing agentRole/piBuiltin are auto-migrated and persisted", async () => {
    mockContent(LEGACY_FIELDS_REGISTRY_JSON);
    const entries = await loadRegistryEntries("/project");

    const togusa = entries.find((e) => e.persistentName === "Togusa") as RegistryEntry;
    expect(togusa).toBeDefined();
    expect(togusa.agentRole).toBe("tester");
    expect(togusa.piBuiltin).toBe("reviewer");
    expect(writeFile).toHaveBeenCalledWith(
      "/project/.squad/casting/registry.json.tmp",
      expect.stringContaining('"agentRole": "tester"'),
      "utf8",
    );
    expect(rename).toHaveBeenCalledWith(
      "/project/.squad/casting/registry.json.tmp",
      "/project/.squad/casting/registry.json",
    );
  });

  it("missing file → returns empty array and does not throw", async () => {
    mockEnoent();
    const entries = await loadRegistryEntries("/project");
    expect(entries).toEqual([]);
  });

  it("invalid JSON → throws RegistryLoadError", async () => {
    mockContent("{ this is not json }");
    await expect(loadRegistryEntries("/project")).rejects.toBeInstanceOf(RegistryLoadError);
  });

  it("RegistryLoadError message includes context", async () => {
    mockContent("definitely not json <<<");
    await expect(loadRegistryEntries("/project")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof RegistryLoadError &&
        err.message.includes("registry.json"),
    );
  });

  it("legacy agents-keyed format is normalised to RegistryEntry[]", async () => {
    mockContent(LEGACY_REGISTRY_JSON);
    const entries = await loadRegistryEntries("/project");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.persistentName).toBe("Motoko");
    expect(entries[0]?.role).toBe("lead");
  });

  it("invalid agentRole string is not attached to the entry", async () => {
    mockContent(JSON.stringify({
      version: "1",
      entries: [
        {
          persistentName: "Unknown",
          role: "unknown",
          universe: "test",
          createdAt: "2026-06-01T00:00:00.000Z",
          legacyNamed: false,
          status: "active",
          agentRole: "not-a-valid-role",
        },
      ],
    }));
    const entries = await loadRegistryEntries("/project");
    expect(entries[0]?.agentRole).toBeUndefined();
  });
});
