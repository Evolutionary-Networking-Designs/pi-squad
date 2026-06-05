import { readFile } from "node:fs/promises";
import path from "node:path";

export interface TeamMember {
  name: string;
  role: string;
}

export interface SquadReader {
  readTeamRoster(squadRoot: string): Promise<TeamMember[]>;
  readCurrentFocus(squadRoot: string): Promise<string | null>;
  readLastDecision(squadRoot: string): Promise<string | null>;
}

type ReadTextFile = (filePath: string) => Promise<string | null>;

const MAX_FOCUS_LENGTH = 200;
const MAX_DECISION_LENGTH = 120;
const MAX_DECISION_LINES = 80;

export function createSquadReader(readTextFileSafe: ReadTextFile): SquadReader {
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
  };
}

export async function readTeamRoster(squadRoot: string): Promise<TeamMember[]> {
  return createSquadReader(readTextFileFromDisk).readTeamRoster(squadRoot);
}

export async function readCurrentFocus(squadRoot: string): Promise<string | null> {
  return createSquadReader(readTextFileFromDisk).readCurrentFocus(squadRoot);
}

export async function readLastDecision(squadRoot: string): Promise<string | null> {
  return createSquadReader(readTextFileFromDisk).readLastDecision(squadRoot);
}

async function readTextFileFromDisk(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
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
