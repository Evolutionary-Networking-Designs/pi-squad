/**
 * @module squad/charter
 *
 * Loads per-agent charter files from `.squad/agents/{id}/charter.md`.
 * The charter is a freeform markdown string used as the agent's system prompt.
 *
 * Design reference: docs/ARCHITECTURE.md §7.1 (custom agents / charters)
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load a single agent's charter from `{squadRoot}/.squad/agents/{agentId}/charter.md`.
 *
 * @param squadRoot - Root directory that contains the `.squad/` folder.
 * @param agentId   - Lowercase agent identifier matching the directory name.
 * @returns The raw charter markdown, or `undefined` if the file does not exist.
 */
export async function loadAgentCharter(
  squadRoot: string,
  agentId: string,
): Promise<string | undefined> {
  const charterPath = join(squadRoot, ".squad", "agents", agentId, "charter.md");
  try {
    return await readFile(charterPath, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Load charters for multiple agents in parallel.
 * Agents without a charter file are silently omitted from the returned map.
 *
 * @param squadRoot - Root directory that contains the `.squad/` folder.
 * @param agentIds  - Ordered list of agent identifiers to load.
 * @returns Map of agentId → charter content (only agents with a charter present).
 */
export async function loadAllCharters(
  squadRoot: string,
  agentIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const entries = await Promise.all(
    agentIds.map(async (id) => {
      const charter = await loadAgentCharter(squadRoot, id);
      return charter !== undefined ? ([id, charter] as const) : null;
    }),
  );

  return new Map(entries.filter((e): e is [string, string] => e !== null));
}
