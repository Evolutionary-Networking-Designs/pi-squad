import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  migrateRegistryEntries,
  migrateRegistryEntry,
  writeMigratedRegistry,
} from "../../src/squad/migration.js";
import type { RegistryEntry } from "../../src/squad/registry-loader.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDir, "..", "..");
const testRoot = join(packageRoot, ".test-work", "migration");

function buildEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    persistentName: "Batou",
    role: "Systems Dev",
    universe: "ghost-in-the-shell",
    createdAt: "2026-06-03T00:00:00.000Z",
    legacyNamed: false,
    status: "active",
    ...overrides,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(testRoot, { recursive: true, force: true });
});

describe("migrateRegistryEntry", () => {
  it("infers missing agentRole/piBuiltin from the legacy role string", () => {
    expect(migrateRegistryEntry(buildEntry())).toEqual({
      ...buildEntry(),
      agentRole: "developer",
      piBuiltin: "worker",
    });
  });

  it("returns the original entry unchanged when agentRole/piBuiltin already exist", () => {
    const entry = buildEntry({ agentRole: "developer", piBuiltin: "worker" });
    expect(migrateRegistryEntry(entry)).toBe(entry);
  });

  it("maps exact Scribe role to agentRole without a piBuiltin", () => {
    expect(migrateRegistryEntry(buildEntry({ persistentName: "Scribe", role: "Scribe" }))).toEqual({
      ...buildEntry({ persistentName: "Scribe", role: "Scribe" }),
      agentRole: "scribe",
    });
  });
});

describe("migrateRegistryEntries", () => {
  it("warns and leaves fields absent for unrecognized roles", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const migrated = migrateRegistryEntries([
      buildEntry({ persistentName: "Unknown", role: "Data Wizard" }),
    ]);

    expect(migrated[0]).toEqual(buildEntry({ persistentName: "Unknown", role: "Data Wizard" }));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Could not infer agentRole/piBuiltin"),
    );
  });
});

describe("writeMigratedRegistry", () => {
  it("writes migrated fields atomically while preserving the original JSON structure", async () => {
    const squadRoot = join(testRoot, "project");
    const registryDir = join(squadRoot, ".squad", "casting");
    const registryPath = join(registryDir, "registry.json");
    await mkdir(registryDir, { recursive: true });

    const originalRaw = {
      version: "1",
      universe: "ghost-in-the-shell",
      extra: { preserved: true },
      entries: [
        {
          persistentName: "Batou",
          role: "Systems Dev",
          universe: "ghost-in-the-shell",
          createdAt: "2026-06-03T00:00:00.000Z",
          legacyNamed: false,
          status: "active",
          customField: "keep-me",
        },
      ],
    };

    await writeFile(registryPath, `${JSON.stringify(originalRaw, null, 2)}\n`, "utf8");

    await writeMigratedRegistry(squadRoot, migrateRegistryEntries([buildEntry()]), originalRaw);

    const persisted = JSON.parse(await readFile(registryPath, "utf8")) as {
      version: string;
      universe: string;
      extra: { preserved: boolean };
      entries: Array<{ customField?: string; agentRole?: string; piBuiltin?: string }>;
    };

    expect(persisted.version).toBe("1");
    expect(persisted.universe).toBe("ghost-in-the-shell");
    expect(persisted.extra).toEqual({ preserved: true });
    expect(persisted.entries[0]?.customField).toBe("keep-me");
    expect(persisted.entries[0]?.agentRole).toBe("developer");
    expect(persisted.entries[0]?.piBuiltin).toBe("worker");
    await expect(access(`${registryPath}.tmp`)).rejects.toThrow();
  });
});
