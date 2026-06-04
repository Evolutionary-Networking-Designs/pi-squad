/**
 * @module casting/registry
 *
 * Cast name registry persistence — loads, saves, and queries
 * .squad/casting/registry.json for persistent agent identity.
 *
 * Design reference: docs/ARCHITECTURE.md §1 (casting system overview)
 */

import { promises as fs } from "node:fs";
import path from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CastEntry {
  persistentName: string;
  role: string;
  universe: string;
  createdAt: string;
  legacyNamed: boolean;
  status: "active" | "retired";
}

export interface CastingRegistry {
  entries: CastEntry[];
  version: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const REGISTRY_VERSION = "1";
const REGISTRY_RELATIVE_PATH = path.join(".squad", "casting", "registry.json");

/** Shape of the on-disk registry.json (may differ from CastingRegistry) */
interface RawRegistryEntry {
  persistentName?: string;
  name?: string;
  role?: string;
  universe?: string;
  createdAt?: string;
  legacyNamed?: boolean;
  status?: string;
  /** Legacy format: agents keyed by name */
  assigned_at?: string;
  character?: string;
}

interface RawRegistryV1 {
  entries?: RawRegistryEntry[];
  version?: string;
  /** Legacy format: top-level "agents" object */
  agents?: Record<string, RawRegistryEntry>;
}

function normaliseSingleEntry(raw: RawRegistryEntry, fallbackName?: string): CastEntry {
  const persistentName = (raw.persistentName ?? raw.name ?? fallbackName ?? "unknown").trim();
  return {
    persistentName,
    role: raw.role ?? "unknown",
    universe: raw.universe ?? "unknown",
    createdAt: raw.createdAt ?? raw.assigned_at ?? new Date(0).toISOString(),
    legacyNamed: raw.legacyNamed ?? false,
    status: raw.status === "retired" ? "retired" : "active",
  };
}

function parseRawRegistry(raw: RawRegistryV1): CastingRegistry {
  // Support both new format ({ entries: [...] }) and legacy format ({ agents: { name: {...} } })
  if (Array.isArray(raw.entries)) {
    return {
      version: raw.version ?? REGISTRY_VERSION,
      entries: raw.entries.map((e) => normaliseSingleEntry(e)),
    };
  }

  if (raw.agents && typeof raw.agents === "object") {
    const entries = Object.entries(raw.agents).map(([name, agent]) =>
      normaliseSingleEntry({ ...agent, name }, name),
    );
    return { version: REGISTRY_VERSION, entries };
  }

  return { version: REGISTRY_VERSION, entries: [] };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Load registry from .squad/casting/registry.json */
export async function loadRegistry(teamRoot: string): Promise<CastingRegistry> {
  const registryPath = path.join(teamRoot, REGISTRY_RELATIVE_PATH);
  try {
    const raw = JSON.parse(await fs.readFile(registryPath, "utf8")) as RawRegistryV1;
    return parseRawRegistry(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: REGISTRY_VERSION, entries: [] };
    }
    throw err;
  }
}

/** Save registry to .squad/casting/registry.json */
export async function saveRegistry(teamRoot: string, registry: CastingRegistry): Promise<void> {
  const registryPath = path.join(teamRoot, REGISTRY_RELATIVE_PATH);
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
}

/** Look up a cast entry by persistent name (case-insensitive) */
export function findByName(registry: CastingRegistry, name: string): CastEntry | undefined {
  const lower = name.toLowerCase();
  return registry.entries.find((e) => e.persistentName.toLowerCase() === lower);
}

/**
 * Add a new entry to the registry.
 * Stamps createdAt with the current ISO timestamp and returns the completed entry.
 */
export function addEntry(
  registry: CastingRegistry,
  entry: Omit<CastEntry, "createdAt">,
): CastEntry {
  const completed: CastEntry = {
    ...entry,
    createdAt: new Date().toISOString(),
  };
  registry.entries.push(completed);
  return completed;
}

/**
 * Retire an agent by persistent name (case-insensitive).
 * Returns true if the agent was found and retired, false if not found.
 */
export function retireAgent(registry: CastingRegistry, name: string): boolean {
  const entry = findByName(registry, name);
  if (!entry) return false;
  entry.status = "retired";
  return true;
}
