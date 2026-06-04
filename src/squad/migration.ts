/**
 * @module squad/migration
 * Auto-migrates registry entries missing agentRole/piBuiltin fields.
 * Called from loadRegistryEntries() on load — no manual migration step required.
 */

import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { agentRoleToBuiltin, type AgentRole } from "./agent-role-map.js";
import type { RegistryEntry } from "./registry-loader.js";

const REGISTRY_RELATIVE_PATH = path.join(".squad", "casting", "registry.json");

interface RawEntry {
  persistentName?: string;
  name?: string;
  role?: string;
  agentRole?: string;
  piBuiltin?: string;
  [key: string]: unknown;
}

interface RawRegistry {
  entries?: unknown;
  agents?: unknown;
  [key: string]: unknown;
}

interface InferredMapping {
  readonly agentRole?: AgentRole;
  readonly piBuiltin?: string;
  readonly recognized: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === "string" && (
    value === "lead" ||
    value === "developer" ||
    value === "tester" ||
    value === "security" ||
    value === "devops" ||
    value === "designer" ||
    value === "reviewer" ||
    value === "prompt-engineer" ||
    value === "scribe"
  );
}

function normaliseRole(value: string): string {
  return value.toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function inferMapping(role: string): InferredMapping {
  const normalized = normaliseRole(role);

  if (normalized === "scribe") {
    return { agentRole: "scribe", recognized: true };
  }

  if (normalized === "ralph") {
    return { recognized: true };
  }

  if (
    normalized.includes("tech lead") ||
    normalized.includes("architect") ||
    normalized.includes("lead")
  ) {
    return { agentRole: "lead", piBuiltin: agentRoleToBuiltin("lead") ?? undefined, recognized: true };
  }

  if (
    normalized.includes("backend dev") ||
    normalized.includes("frontend dev") ||
    normalized.includes("systems dev") ||
    normalized.includes("developer")
  ) {
    return {
      agentRole: "developer",
      piBuiltin: agentRoleToBuiltin("developer") ?? undefined,
      recognized: true,
    };
  }

  if (normalized.includes("tester") || /\bqa\b/u.test(normalized)) {
    return { agentRole: "tester", piBuiltin: agentRoleToBuiltin("tester") ?? undefined, recognized: true };
  }

  if (normalized.includes("security")) {
    return {
      agentRole: "security",
      piBuiltin: agentRoleToBuiltin("security") ?? undefined,
      recognized: true,
    };
  }

  if (normalized.includes("devops") || normalized.includes("dev ops") || normalized.includes("infra")) {
    return { agentRole: "devops", piBuiltin: agentRoleToBuiltin("devops") ?? undefined, recognized: true };
  }

  if (normalized.includes("prompt engineer")) {
    return {
      agentRole: "prompt-engineer",
      piBuiltin: agentRoleToBuiltin("prompt-engineer") ?? undefined,
      recognized: true,
    };
  }

  return { recognized: false };
}

function needsMigration(entry: RegistryEntry): boolean {
  return entry.agentRole === undefined || entry.piBuiltin === undefined;
}

function applyMigratedFields(rawEntry: RawEntry, migratedEntry: RegistryEntry): boolean {
  let changed = false;

  if (!isAgentRole(rawEntry.agentRole) && migratedEntry.agentRole !== undefined) {
    rawEntry.agentRole = migratedEntry.agentRole;
    changed = true;
  }

  if (rawEntry.piBuiltin === undefined && migratedEntry.piBuiltin !== undefined) {
    rawEntry.piBuiltin = migratedEntry.piBuiltin;
    changed = true;
  }

  return changed;
}

/**
 * Infer agentRole + piBuiltin from the registry role string when either field is absent.
 */
export function migrateRegistryEntry(entry: RegistryEntry): RegistryEntry {
  if (!needsMigration(entry)) {
    return entry;
  }

  const inferred = inferMapping(entry.role);
  let changed = false;
  let migrated = entry;

  if (migrated.agentRole === undefined && inferred.agentRole !== undefined) {
    migrated = { ...migrated, agentRole: inferred.agentRole };
    changed = true;
  }

  if (migrated.piBuiltin === undefined && inferred.piBuiltin !== undefined) {
    migrated = { ...migrated, piBuiltin: inferred.piBuiltin };
    changed = true;
  }

  return changed ? migrated : entry;
}

/**
 * Migrate a batch of registry entries, warning when an old role string cannot be inferred.
 */
export function migrateRegistryEntries(entries: RegistryEntry[]): RegistryEntry[] {
  return entries.map((entry) => {
    const migrated = migrateRegistryEntry(entry);
    if (migrated === entry && needsMigration(entry) && !inferMapping(entry.role).recognized) {
      console.warn(
        `[pi-squad] Could not infer agentRole/piBuiltin for registry entry ` +
        `'${entry.persistentName}' with role '${entry.role}'.`,
      );
    }
    return migrated;
  });
}

/**
 * Persist migrated fields back into `.squad/casting/registry.json` while preserving
 * all unrelated raw JSON fields and structure.
 */
export async function writeMigratedRegistry(
  squadRoot: string,
  entries: RegistryEntry[],
  originalRaw: unknown,
): Promise<void> {
  if (!isRecord(originalRaw)) {
    return;
  }

  const cloned = structuredClone(originalRaw) as RawRegistry;
  let changed = false;

  if (Array.isArray(cloned.entries)) {
    cloned.entries.forEach((candidate, index) => {
      if (!isRecord(candidate)) {
        return;
      }
      const migratedEntry = entries[index];
      if (!migratedEntry) {
        return;
      }
      changed = applyMigratedFields(candidate as RawEntry, migratedEntry) || changed;
    });
  } else if (isRecord(cloned.agents)) {
    for (const [name, candidate] of Object.entries(cloned.agents)) {
      if (!isRecord(candidate)) {
        continue;
      }
      const rawEntry = candidate as RawEntry;
      const persistentName = (rawEntry.persistentName ?? rawEntry.name ?? name).trim().toLowerCase();
      const migratedEntry = entries.find((entry) => entry.persistentName.toLowerCase() === persistentName);
      if (!migratedEntry) {
        continue;
      }
      changed = applyMigratedFields(rawEntry, migratedEntry) || changed;
    }
  }

  if (!changed) {
    return;
  }

  const registryPath = path.join(squadRoot, REGISTRY_RELATIVE_PATH);
  const tempPath = `${registryPath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(cloned, null, 2)}\n`, "utf8");
  await rename(tempPath, registryPath);
}
