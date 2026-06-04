/**
 * @module squad/registry-loader
 *
 * Loads `.squad/casting/registry.json` at extension init time and returns
 * a typed RegistryEntry[] that includes the p3 agentRole and piBuiltin fields.
 *
 * Gracefully degrades: missing file → empty array + warning; invalid JSON → throws RegistryLoadError.
 *
 * Design reference: docs/ARCHITECTURE.md §3 (casting system), §6.3 (graceful degradation)
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { migrateRegistryEntries, writeMigratedRegistry } from "./migration.js";
import type { AgentRole } from "./agent-role-map.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Base casting entry as persisted in registry.json.
 * Mirrors CastEntry from src/casting/registry.ts for squad-side consumers.
 */
export interface CastingEntry {
  readonly persistentName: string;
  readonly role: string;
  readonly universe: string;
  readonly createdAt: string;
  readonly legacyNamed: boolean;
  readonly status: "active" | "retired";
}

/**
 * Extended registry entry with p3 squad-typed fields.
 * Both new fields are optional — the p3.8 migration writes them;
 * a registry written by an older version will simply omit them.
 */
export interface RegistryEntry extends CastingEntry {
  readonly agentRole?: AgentRole;
  readonly piBuiltin?: string;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/** Thrown when registry.json exists but cannot be parsed as valid JSON. */
export class RegistryLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryLoadError";
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const REGISTRY_RELATIVE_PATH = path.join(".squad", "casting", "registry.json");

/** Raw shape of a single entry as it may appear on disk (permissive). */
interface RawEntry {
  persistentName?: string;
  name?: string;
  role?: string;
  universe?: string;
  createdAt?: string;
  assigned_at?: string;
  legacyNamed?: boolean;
  status?: string;
  agentRole?: string;
  piBuiltin?: string;
}

/** Raw on-disk structure supporting both current and legacy registry formats. */
interface RawRegistry {
  entries?: RawEntry[];
  version?: string;
  agents?: Record<string, RawEntry>;
}

function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === "string" && (
    value === "lead" ||
    value === "developer" ||
    value === "tester" ||
    value === "security" ||
    value === "devops" ||
    value === "designer" ||
    value === "prompt-engineer" ||
    value === "reviewer" ||
    value === "scribe"
  );
}

function normaliseEntry(raw: RawEntry, fallbackName?: string): RegistryEntry {
  const persistentName = (raw.persistentName ?? raw.name ?? fallbackName ?? "unknown").trim();
  const entry: RegistryEntry = {
    persistentName,
    role:         raw.role      ?? "unknown",
    universe:     raw.universe  ?? "unknown",
    createdAt:    raw.createdAt ?? raw.assigned_at ?? new Date(0).toISOString(),
    legacyNamed:  raw.legacyNamed ?? false,
    status:       raw.status === "retired" ? "retired" : "active",
  };

  // Only attach p3 fields when they are valid to preserve the optional contract.
  if (isAgentRole(raw.agentRole)) {
    return { ...entry, agentRole: raw.agentRole, piBuiltin: raw.piBuiltin };
  }

  if (raw.piBuiltin !== undefined) {
    return { ...entry, piBuiltin: raw.piBuiltin };
  }

  return entry;
}

function parseRawRegistry(raw: RawRegistry): RegistryEntry[] {
  if (Array.isArray(raw.entries)) {
    return raw.entries.map((e) => normaliseEntry(e));
  }

  if (raw.agents && typeof raw.agents === "object") {
    return Object.entries(raw.agents).map(([name, entry]) =>
      normaliseEntry({ ...entry, name }, name),
    );
  }

  return [];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load `.squad/casting/registry.json` from the given Squad root directory.
 *
 * @param squadRoot - Absolute path to the directory containing `.squad/`.
 *   Callers (not this module) are responsible for resolving the project root;
 *   this keeps the loader testable without touching import.meta.url paths.
 * @returns Parsed RegistryEntry array; empty array when the file does not exist.
 * @throws {RegistryLoadError} When the file exists but contains invalid JSON.
 */
export async function loadRegistryEntries(squadRoot: string): Promise<RegistryEntry[]> {
  const registryPath = path.join(squadRoot, REGISTRY_RELATIVE_PATH);

  let raw: string;
  try {
    raw = await readFile(registryPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(
        `[pi-squad] .squad/casting/registry.json not found at ${registryPath}; no agents cast yet.`,
      );
      return [];
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new RegistryLoadError(
      `Failed to parse .squad/casting/registry.json: ${(err as Error).message}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new RegistryLoadError("registry.json must be a JSON object");
  }

  const entries = parseRawRegistry(parsed as RawRegistry);
  const migratedEntries = migrateRegistryEntries(entries);
  const hasMigratedEntries = entries.some((entry, index) => {
    const migrated = migratedEntries[index];
    return entry.agentRole !== migrated?.agentRole || entry.piBuiltin !== migrated?.piBuiltin;
  });

  if (hasMigratedEntries) {
    await writeMigratedRegistry(squadRoot, migratedEntries, parsed);
  }

  return migratedEntries;
}
