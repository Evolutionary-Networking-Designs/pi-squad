/**
 * @module casting/registry
 *
 * Cast name registry persistence — loads, saves, and queries
 * .squad/casting/registry.json for persistent agent identity.
 *
 * Design reference: docs/ARCHITECTURE.md §1 (casting system overview)
 */
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
/** Load registry from .squad/casting/registry.json */
export declare function loadRegistry(teamRoot: string): Promise<CastingRegistry>;
/** Save registry to .squad/casting/registry.json */
export declare function saveRegistry(teamRoot: string, registry: CastingRegistry): Promise<void>;
/** Look up a cast entry by persistent name (case-insensitive) */
export declare function findByName(registry: CastingRegistry, name: string): CastEntry | undefined;
/**
 * Add a new entry to the registry.
 * Stamps createdAt with the current ISO timestamp and returns the completed entry.
 */
export declare function addEntry(registry: CastingRegistry, entry: Omit<CastEntry, "createdAt">): CastEntry;
/**
 * Retire an agent by persistent name (case-insensitive).
 * Returns true if the agent was found and retired, false if not found.
 */
export declare function retireAgent(registry: CastingRegistry, name: string): boolean;
//# sourceMappingURL=registry.d.ts.map