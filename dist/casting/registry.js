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
// ─── Internal helpers ─────────────────────────────────────────────────────────
const REGISTRY_VERSION = "1";
const REGISTRY_RELATIVE_PATH = path.join(".squad", "casting", "registry.json");
function normaliseSingleEntry(raw, fallbackName) {
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
function parseRawRegistry(raw) {
    // Support both new format ({ entries: [...] }) and legacy format ({ agents: { name: {...} } })
    if (Array.isArray(raw.entries)) {
        return {
            version: raw.version ?? REGISTRY_VERSION,
            entries: raw.entries.map((e) => normaliseSingleEntry(e)),
        };
    }
    if (raw.agents && typeof raw.agents === "object") {
        const entries = Object.entries(raw.agents).map(([name, agent]) => normaliseSingleEntry({ ...agent, name }, name));
        return { version: REGISTRY_VERSION, entries };
    }
    return { version: REGISTRY_VERSION, entries: [] };
}
// ─── Public API ───────────────────────────────────────────────────────────────
/** Load registry from .squad/casting/registry.json */
export async function loadRegistry(teamRoot) {
    const registryPath = path.join(teamRoot, REGISTRY_RELATIVE_PATH);
    try {
        const raw = JSON.parse(await fs.readFile(registryPath, "utf8"));
        return parseRawRegistry(raw);
    }
    catch (err) {
        if (err.code === "ENOENT") {
            return { version: REGISTRY_VERSION, entries: [] };
        }
        throw err;
    }
}
/** Save registry to .squad/casting/registry.json */
export async function saveRegistry(teamRoot, registry) {
    const registryPath = path.join(teamRoot, REGISTRY_RELATIVE_PATH);
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
}
/** Look up a cast entry by persistent name (case-insensitive) */
export function findByName(registry, name) {
    const lower = name.toLowerCase();
    return registry.entries.find((e) => e.persistentName.toLowerCase() === lower);
}
/**
 * Add a new entry to the registry.
 * Stamps createdAt with the current ISO timestamp and returns the completed entry.
 */
export function addEntry(registry, entry) {
    const completed = {
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
export function retireAgent(registry, name) {
    const entry = findByName(registry, name);
    if (!entry)
        return false;
    entry.status = "retired";
    return true;
}
//# sourceMappingURL=registry.js.map