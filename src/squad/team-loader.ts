/**
 * @module squad/team-loader
 *
 * Parses `.squad/team.md` into typed `TeamMember[]` objects.
 * Gracefully degrades — malformed rows are skipped with a warning, never thrown.
 *
 * Design reference: docs/ARCHITECTURE.md §6.3 (graceful degradation)
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { TeamMember } from "../coordinator/router.js";

// ─── Column Map ───────────────────────────────────────────────────────────────

/**
 * Maps logical field names to their column index in the parsed table.
 * Index -1 means the column is absent from this table's header.
 */
interface ColMap {
  readonly id: number;
  readonly role: number;
  readonly emoji: number;  // -1 when the emoji column is not present
  readonly skills: number; // -1 when the skills column is not present
}

const DEFAULT_COL_MAP: ColMap = { id: 0, role: 1, emoji: 2, skills: 3 };

/**
 * Build a ColMap from the header row cells.
 * Falls back to DEFAULT_COL_MAP if no recognisable header cells are found.
 */
function detectColMap(headerCells: readonly string[]): ColMap {
  let id = -1, role = -1, emoji = -1, skills = -1;

  headerCells.forEach((cell, i) => {
    const c = cell.toLowerCase().trim();
    if (/^(agent|member|name)$/u.test(c)) id = i;
    else if (c === "role") role = i;
    else if (c === "emoji") emoji = i;
    else if (/^skills?$/u.test(c)) skills = i;
  });

  // If nothing was recognised, use positional defaults.
  if (id === -1 && role === -1 && emoji === -1 && skills === -1) {
    return DEFAULT_COL_MAP;
  }

  return {
    id:     id     !== -1 ? id     : 0,
    role:   role   !== -1 ? role   : 1,
    emoji:  emoji,   // preserve -1 when column is absent
    skills: skills !== -1 ? skills : (emoji !== -1 ? 3 : 2),
  };
}

// ─── Row Parsing ──────────────────────────────────────────────────────────────

/**
 * Attempt to build a TeamMember from raw table cells using the provided ColMap.
 * Returns null and emits a warning if the row is unusable.
 */
function parseTeamMember(cells: readonly string[], colMap: ColMap): TeamMember | null {
  try {
    // Require at least 2 cells (id + one other field); single-cell rows are malformed.
    if (cells.length < 2) {
      return null;
    }

    const rawId = cells[colMap.id];
    if (!rawId) {
      return null;
    }

    const id = rawId.toLowerCase().trim();
    if (!id) {
      return null;
    }

    // Keep the display name as-is if it contains uppercase, otherwise capitalize.
    const rawName = rawId.trim();
    const name =
      rawName === rawName.toLowerCase()
        ? rawName.charAt(0).toUpperCase() + rawName.slice(1)
        : rawName;

    const role = (colMap.role >= 0 ? cells[colMap.role] : undefined)?.trim() ?? "";
    const emoji = (colMap.emoji >= 0 ? cells[colMap.emoji] : undefined)?.trim() ?? "";
    const skillsRaw = (colMap.skills >= 0 ? cells[colMap.skills] : undefined)?.trim() ?? "";
    const skills: readonly string[] = skillsRaw
      ? skillsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    return { id, name, role, emoji, skills };
  } catch (e) {
    console.warn(
      `[pi-squad] Unknown team member format, skipping: ${(e as Error).message}`,
    );
    return null;
  }
}

// ─── Section & Table Parsing ──────────────────────────────────────────────────

/**
 * Extract lines from the `## Members` section.
 * Falls back to the entire file if no such heading is found.
 */
function extractMembersSection(source: string): readonly string[] {
  const lines = source.split(/\r?\n/u);
  const startIndex = lines.findIndex((l) => /^##\s+members\b/iu.test(l.trim()));

  if (startIndex === -1) {
    return lines;
  }

  // Collect until next same-or-higher-level heading or end of file.
  const section: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/u.test(lines[i])) {
      break;
    }
    section.push(lines[i]);
  }
  return section;
}

function isHeaderRow(cells: readonly string[]): boolean {
  return cells.length > 0 && /^(agent|member|name)$/iu.test(cells[0] ?? "");
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.length > 0 && /^[:\-\s]+$/u.test(cells[0] ?? "");
}

function parseTableRows(lines: readonly string[]): readonly TeamMember[] {
  const members: TeamMember[] = [];
  let colMap: ColMap = DEFAULT_COL_MAP;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
      continue;
    }

    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (!cells[0]) {
      continue;
    }

    if (isSeparatorRow(cells)) {
      continue;
    }

    if (isHeaderRow(cells)) {
      // Build a column map from this header so data rows are field-aware.
      colMap = detectColMap(cells);
      continue;
    }

    const member = parseTeamMember(cells, colMap);
    if (member !== null) {
      members.push(member);
    }
  }

  return members;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load and parse `.squad/team.md` into a typed array of `TeamMember` objects.
 *
 * @param teamMdPath - Absolute path to the `team.md` file.
 * @returns Parsed team members, or `[]` if the file is missing or unreadable.
 */
export async function loadTeamMembers(
  teamMdPath: string,
): Promise<readonly TeamMember[]> {
  let source: string;
  try {
    source = await readFile(teamMdPath, "utf8");
  } catch {
    return [];
  }

  const sectionLines = extractMembersSection(source);
  return parseTableRows(sectionLines);
}

/**
 * Compute a SHA-256 hash of the given file content for cache invalidation.
 * Exported so callers (e.g. DispatchTable builders) can reuse it.
 */
export function hashSource(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}
