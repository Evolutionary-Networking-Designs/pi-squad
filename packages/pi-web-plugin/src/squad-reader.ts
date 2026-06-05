import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export interface TeamMember {
  name: string;
  role: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  modifiedAt?: string;
}

export interface LatestActivity {
  agentName: string;
  task: string;
  modifiedAt?: string;
}

export interface SquadReader {
  readTeamRoster(squadRoot: string): Promise<TeamMember[]>;
  readCurrentFocus(squadRoot: string): Promise<string | null>;
  readLastDecision(squadRoot: string): Promise<string | null>;
  readDecisionCount(squadRoot: string): Promise<number | null>;
  readLatestActivity(squadRoot: string): Promise<LatestActivity | null>;
}

type ReadTextFile = (filePath: string) => Promise<string | null>;
type ListDirectory = (directoryPath: string) => Promise<DirectoryEntry[]>;

const MAX_FOCUS_LENGTH = 200;
const MAX_DECISION_LENGTH = 120;
const MAX_ACTIVITY_LENGTH = 120;
const MAX_DECISION_LINES = 80;

export function createSquadReader(
  readTextFileSafe: ReadTextFile,
  listDirectorySafe: ListDirectory = async () => [],
): SquadReader {
  return {
    async readTeamRoster(squadRoot: string): Promise<TeamMember[]> {
      const text = await readTextFileSafe(path.posix.join(squadRoot, "team.md"));
      return parseTeamRoster(text);
    },
    async readCurrentFocus(squadRoot: string): Promise<string | null> {
      const text = await readTextFileSafe(path.posix.join(squadRoot, "identity", "now.md"));
      return normalizeExcerpt(text, MAX_FOCUS_LENGTH);
    },
    async readLastDecision(squadRoot: string): Promise<string | null> {
      const text = await readTextFileSafe(path.posix.join(squadRoot, "decisions.md"));
      return parseLastDecision(text);
    },
    async readDecisionCount(squadRoot: string): Promise<number | null> {
      const text = await readTextFileSafe(path.posix.join(squadRoot, "decisions.md"));
      return countDecisions(text);
    },
    async readLatestActivity(squadRoot: string): Promise<LatestActivity | null> {
      const entries = await listDirectorySafe(path.posix.join(squadRoot, "orchestration-log"));
      const latestEntry = entries
        .filter((entry) => entry.type === "file" && entry.name.endsWith(".md"))
        .sort(compareEntriesByModifiedDesc)[0];
      if (latestEntry === undefined) return null;

      const text = await readTextFileSafe(path.posix.join(squadRoot, "orchestration-log", latestEntry.name));
      const parsed = parseLatestActivity(text);
      return parsed === null ? null : { ...parsed, modifiedAt: latestEntry.modifiedAt };
    },
  };
}

export async function readTeamRoster(squadRoot: string): Promise<TeamMember[]> {
  return createSquadReader(readTextFileFromDisk, listDirectoryFromDisk).readTeamRoster(squadRoot);
}

export async function readCurrentFocus(squadRoot: string): Promise<string | null> {
  return createSquadReader(readTextFileFromDisk, listDirectoryFromDisk).readCurrentFocus(squadRoot);
}

export async function readLastDecision(squadRoot: string): Promise<string | null> {
  return createSquadReader(readTextFileFromDisk, listDirectoryFromDisk).readLastDecision(squadRoot);
}

export async function readDecisionCount(squadRoot: string): Promise<number | null> {
  return createSquadReader(readTextFileFromDisk, listDirectoryFromDisk).readDecisionCount(squadRoot);
}

export async function readLatestActivity(squadRoot: string): Promise<LatestActivity | null> {
  return createSquadReader(readTextFileFromDisk, listDirectoryFromDisk).readLatestActivity(squadRoot);
}

async function readTextFileFromDisk(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function listDirectoryFromDisk(directoryPath: string): Promise<DirectoryEntry[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return await Promise.all(entries.map(async (entry) => {
      const filePath = path.join(directoryPath, entry.name);
      const stats = await lstat(filePath);
      return {
        name: entry.name,
        path: path.posix.join(directoryPath, entry.name),
        type: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file",
        modifiedAt: stats.mtime.toISOString(),
      } satisfies DirectoryEntry;
    }));
  } catch {
    return [];
  }
}

function parseTeamRoster(markdown: string | null): TeamMember[] {
  if (markdown === null || markdown.trim() === "") return [];

  const section = extractSection(markdown, "Members");
  if (section === null) return [];

  const members: TeamMember[] = [];
  for (const line of section.split(/\r?\n/u)) {
    const cells = parseTableRow(line);
    if (cells === null || cells.length < 2) continue;
    if (isSeparatorRow(cells)) continue;
    if (cells[0]?.toLowerCase() === "name" && cells[1]?.toLowerCase() === "role") continue;

    const name = stripMarkdown(cells[0] ?? "");
    const role = stripMarkdown(cells[1] ?? "");
    if (name !== "" && role !== "") members.push({ name, role });
  }

  return members;
}

function countDecisions(markdown: string | null): number | null {
  if (markdown === null || markdown.trim() === "") return null;
  const matches = markdown.match(/^##\s+/gmu);
  return matches?.length ?? 0;
}

function parseLatestActivity(markdown: string | null): LatestActivity | null {
  if (markdown === null || markdown.trim() === "") return null;

  const lines = markdown.split(/\r?\n/u);
  const headingLine = lines.find((line) => line.startsWith("# "));
  const heading = headingLine === undefined ? null : normalizeWhitespace(stripMarkdown(lineSansHeading(headingLine)));
  const agentName = normalizeAgentName(readLabeledValue(lines, "Agent"))
    ?? inferAgentNameFromHeading(heading)
    ?? "Squad";

  const task = readLabeledValue(lines, "Action")
    ?? readLabeledValue(lines, "Directive")
    ?? readLabeledValue(lines, "Ceremony")
    ?? readLabeledValue(lines, "Scope")
    ?? inferTaskFromHeading(heading, agentName)
    ?? firstMeaningfulSentence(lines.slice(1));

  if (task === null) return null;
  return {
    agentName,
    task: truncate(normalizeWhitespace(stripMarkdown(task)), MAX_ACTIVITY_LENGTH),
  };
}

function extractSection(markdown: string, heading: string): string | null {
  const lines = markdown.split(/\r?\n/u);
  let inSection = false;
  const collected: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (inSection) break;
      inSection = line.slice(3).trim() === heading;
      continue;
    }
    if (inSection) collected.push(line);
  }

  return collected.length > 0 ? collected.join("\n") : null;
}

function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  return trimmed
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function normalizeExcerpt(markdown: string | null, limit: number): string | null {
  const normalized = normalizeWhitespace(stripMarkdown(markdown ?? ""));
  if (normalized === "") return null;
  return truncate(normalized, limit);
}

function parseLastDecision(markdown: string | null): string | null {
  if (markdown === null || markdown.trim() === "") return null;

  const lines = markdown.split(/\r?\n/u).slice(-MAX_DECISION_LINES);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line.startsWith("## ")) continue;

    const heading = stripMarkdown(line.slice(3));
    const detail = firstMeaningfulSentence(lines.slice(index + 1));
    const summary = detail === null ? heading : `${heading} — ${detail}`;
    const normalized = truncate(normalizeWhitespace(summary), MAX_DECISION_LENGTH);
    return normalized === "" ? null : normalized;
  }

  return null;
}

function firstMeaningfulSentence(lines: string[]): string | null {
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed === ""
      || trimmed === "---"
      || trimmed.startsWith("## ")
      || trimmed.startsWith("**By:**")
      || trimmed.startsWith("**Status:**")
      || trimmed.startsWith("**Date:**")
      || trimmed.startsWith("**Agent:**")
      || trimmed.startsWith("**Session:**")
    ) {
      continue;
    }

    const plain = normalizeWhitespace(stripMarkdown(trimmed.replace(/^[-*]\s+/u, "")));
    if (plain === "") continue;
    return firstSentence(plain);
  }

  return null;
}

function firstSentence(text: string): string {
  const match = text.match(/^(.*?[.!?])(?:\s|$)/u);
  return match?.[1] ?? text;
}

function normalizeAgentName(raw: string | null): string | null {
  if (raw === null) return null;
  const plain = normalizeWhitespace(stripMarkdown(raw));
  if (plain === "") return null;
  return plain.split(/\s+[(-]/u)[0] ?? null;
}

function inferAgentNameFromHeading(heading: string | null): string | null {
  if (heading === null || heading === "") return null;

  const stripped = heading.replace(/^\d{4}[^:]*:\s*/u, "").replace(/\s+\([^)]*\)$/u, "");
  const [candidate] = stripped.split(/\s+—\s+/u, 1);
  const agentName = normalizeWhitespace(candidate?.replace(/\s+Orchestration$/u, "") ?? "");
  return agentName === "" ? null : agentName;
}

function inferTaskFromHeading(heading: string | null, agentName: string): string | null {
  if (heading === null || heading === "") return null;

  const stripped = heading.replace(/^\d{4}[^:]*:\s*/u, "").replace(/\s+\([^)]*\)$/u, "");
  const parts = stripped.split(/\s+—\s+/u);
  if (parts.length >= 2) return parts.slice(1).join(" — ");

  const compact = stripped.replace(new RegExp(`^${escapeRegex(agentName)}\\s+`, "u"), "").trim();
  return compact === "" ? null : compact;
}

function readLabeledValue(lines: string[], label: string): string | null {
  const pattern = new RegExp(`^\\*\\*${escapeRegex(label)}:\\*\\*\\s*(.+)$`, "u");
  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) continue;
    const value = normalizeWhitespace(stripMarkdown(match[1] ?? ""));
    if (value !== "") return firstSentence(value);
  }
  return null;
}

function lineSansHeading(line: string): string {
  return line.replace(/^#\s+/u, "").trim();
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[`*_>#]/gu, "")
    .replace(/\|/gu, " ")
    .trim();
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function compareEntriesByModifiedDesc(a: DirectoryEntry, b: DirectoryEntry): number {
  return toTimestamp(b.modifiedAt) - toTimestamp(a.modifiedAt) || a.name.localeCompare(b.name);
}

function toTimestamp(value: string | undefined): number {
  if (value === undefined) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
