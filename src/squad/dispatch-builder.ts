/**
 * @module squad/dispatch-builder
 *
 * Builds a `DispatchTable` from a .squad/ directory by composing the
 * team-loader and routing parsers.
 *
 * Design reference: docs/ARCHITECTURE.md §2 (coordinator init), §6.3 (graceful degradation)
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { DispatchTable } from "../coordinator/router.js";
import { loadTeamMembers } from "./team-loader.js";
import { loadRoutingRules } from "./routing.js";

/**
 * Read a file as UTF-8, returning an empty string if the file is missing or
 * unreadable. Never throws — used for hash computation where a missing file
 * contributes empty content rather than an error.
 */
async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

/**
 * Build a DispatchTable from a .squad/ directory.
 *
 * Gracefully handles missing files — both `team.md` and `routing.md` are
 * optional; absent files contribute empty members/rules to the table.
 *
 * @param squadRoot - The directory containing the `.squad/` folder (i.e. the
 *   team root path returned by `getTeamRoot()`).
 */
export async function buildDispatchTable(squadRoot: string): Promise<DispatchTable> {
  const teamMdPath = join(squadRoot, ".squad", "team.md");
  const routingMdPath = join(squadRoot, ".squad", "routing.md");

  const [members, rules, teamContent, routingContent] = await Promise.all([
    loadTeamMembers(teamMdPath),
    loadRoutingRules(routingMdPath),
    readFileSafe(teamMdPath),
    readFileSafe(routingMdPath),
  ]);

  const sourceHash = createHash("sha256")
    .update(teamContent)
    .update(routingContent)
    .digest("hex");

  return {
    members: new Map(members.map((m) => [m.id, m])),
    rules,
    parsedAt: new Date().toISOString(),
    sourceHash,
    // `parent` is undefined — set only for multi-team repo escalation (not needed here).
  };
}
