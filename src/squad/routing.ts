/**
 * @module squad/routing
 *
 * Parses `.squad/routing.md` into typed `RoutingRule[]`.
 * Tolerant parser — missing file or unexpected format returns `[]` rather than throwing.
 *
 * Design reference: docs/ARCHITECTURE.md §6.3 (graceful degradation), §2 (routing)
 */

import { readFile } from "node:fs/promises";

import type { RoutingRule } from "../coordinator/router.js";

// ─── Pattern Parsing ──────────────────────────────────────────────────────────

/**
 * If the pattern string is wrapped in `/…/` (with optional flags), parse it as a RegExp.
 * Otherwise return it as a plain string for substring matching.
 */
function parsePattern(raw: string): RegExp | string {
  const regexLiteral = /^\/(.+)\/([gimsuy]*)$/u.exec(raw.trim());
  if (regexLiteral) {
    try {
      return new RegExp(regexLiteral[1], regexLiteral[2]);
    } catch {
      console.warn(`[pi-squad] Invalid regex pattern "${raw}" in routing.md; treating as string.`);
    }
  }
  return raw.trim();
}

// ─── Row Parsing ──────────────────────────────────────────────────────────────

/**
 * Build a RoutingRule from raw table cells.
 * Returns null and emits a warning for unusable rows.
 */
function parseRoutingRule(cells: readonly string[]): RoutingRule | null {
  try {
    const rawPattern = cells[0];
    const rawAgentId = cells[1];

    if (!rawPattern || !rawAgentId) {
      return null;
    }

    const pattern = parsePattern(rawPattern);
    const agentId = rawAgentId.toLowerCase().trim();
    const priority = parseInt(cells[2] ?? "0", 10);

    return {
      pattern,
      agentId,
      priority: Number.isFinite(priority) ? priority : 0,
    };
  } catch (e) {
    console.warn(
      `[pi-squad] Unknown routing rule format, skipping: ${(e as Error).message}`,
    );
    return null;
  }
}

// ─── Section & Table Parsing ──────────────────────────────────────────────────

function isHeaderRow(cells: readonly string[]): boolean {
  return cells.length > 0 && /^(pattern|rule|match)$/iu.test(cells[0] ?? "");
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.length > 0 && /^[:\-\s]+$/u.test(cells[0] ?? "");
}

/**
 * Extract lines from the `## Rules` section.
 * Falls back to the entire file if no such heading exists.
 */
function extractRulesSection(source: string): readonly string[] {
  const lines = source.split(/\r?\n/u);
  const startIndex = lines.findIndex((l) => /^##\s+rules\b/iu.test(l.trim()));

  if (startIndex === -1) {
    return lines;
  }

  const section: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/u.test(lines[i])) {
      break;
    }
    section.push(lines[i]);
  }
  return section;
}

function parseTableRows(lines: readonly string[]): readonly RoutingRule[] {
  const rules: RoutingRule[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
      continue;
    }

    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (!cells[0] || isSeparatorRow(cells) || isHeaderRow(cells)) {
      continue;
    }

    const rule = parseRoutingRule(cells);
    if (rule !== null) {
      rules.push(rule);
    }
  }

  return rules;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load and parse `.squad/routing.md` into an ordered array of `RoutingRule` objects.
 *
 * Rules are sorted by priority descending (highest priority evaluated first).
 * Ties preserve source order.
 *
 * @param routingMdPath - Absolute path to the `routing.md` file.
 * @returns Parsed routing rules sorted by priority, or `[]` if the file is missing.
 */
export async function loadRoutingRules(
  routingMdPath: string,
): Promise<readonly RoutingRule[]> {
  let source: string;
  try {
    source = await readFile(routingMdPath, "utf8");
  } catch {
    return [];
  }

  const sectionLines = extractRulesSection(source);
  const rules = parseTableRows(sectionLines);

  // Stable sort: higher priority first, source order preserved for ties.
  return [...rules].sort((a, b) => b.priority - a.priority);
}
