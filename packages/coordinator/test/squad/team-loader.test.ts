import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";
import type { TeamMember } from "../../src/coordinator/router.js";
import { loadTeamMembers } from "../../src/squad/team-loader.js";

// Helpers to keep mock setup terse without using `any`
function mockContent(content: string): void {
  vi.mocked(readFile).mockResolvedValue(content as unknown as Buffer);
}

function mockEnoent(): void {
  vi.mocked(readFile).mockRejectedValue(
    Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" }),
  );
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WELL_FORMED_TEAM_MD = `
# pi-squad

## Members

| Agent | Role | Emoji | Skills |
|-------|------|-------|--------|
| Motoko | Lead | 🏗️ | architecture,planning,review |
| Batou | Extension Dev | 🔧 | typescript,pi-sdk,extensions |
| Togusa | Tester/QA | 🧪 | testing,vitest,quality |
`.trim();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("loadTeamMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: parses a well-formed team.md and returns 3 TeamMember objects", async () => {
    mockContent(WELL_FORMED_TEAM_MD);
    const members = await loadTeamMembers("/project/.squad/team.md");

    expect(members).toHaveLength(3);

    const motoko = members.find((m) => m.id === "motoko") as TeamMember;
    expect(motoko).toBeDefined();
    expect(motoko.name).toBe("Motoko");
    expect(motoko.role).toBe("Lead");
    expect(motoko.emoji).toBe("🏗️");

    const batou = members.find((m) => m.id === "batou") as TeamMember;
    expect(batou).toBeDefined();
    expect(batou.role).toBe("Extension Dev");

    const togusa = members.find((m) => m.id === "togusa") as TeamMember;
    expect(togusa).toBeDefined();
    expect(togusa.role).toBe("Tester/QA");
  });

  it("id is lowercased: 'Motoko' in table → id is 'motoko'", async () => {
    mockContent(`
# Squad

## Members

| Agent | Role | Emoji | Skills |
|-------|------|-------|--------|
| Motoko | Lead | 🏗️ | architecture |
`.trim());

    const members = await loadTeamMembers("/project/.squad/team.md");
    expect(members).toHaveLength(1);
    expect(members[0]?.id).toBe("motoko");
  });

  it("skills parsed from CSV: 'typescript,pi-sdk,extensions' → skills array of 3 strings", async () => {
    mockContent(WELL_FORMED_TEAM_MD);
    const members = await loadTeamMembers("/project/.squad/team.md");

    const batou = members.find((m) => m.id === "batou") as TeamMember;
    expect(batou.skills).toEqual(["typescript", "pi-sdk", "extensions"]);
    expect(batou.skills).toHaveLength(3);
  });

  it("missing emoji column: table without emoji → emoji defaults to empty string", async () => {
    mockContent(`
# Squad

## Members

| Agent | Role | Skills |
|-------|------|--------|
| togusa | Tester/QA | testing,vitest |
`.trim());

    const members = await loadTeamMembers("/project/.squad/team.md");
    expect(members).toHaveLength(1);
    expect(members[0]?.emoji).toBe("");
  });

  it("malformed row is skipped: row with only 1 cell in a 4-column table is skipped", async () => {
    mockContent(`
# Squad

## Members

| Agent | Role | Emoji | Skills |
|-------|------|-------|--------|
| motoko | Lead | 🏗️ | architecture |
| bad-row |
| togusa | Tester/QA | 🧪 | testing |
`.trim());

    const members = await loadTeamMembers("/project/.squad/team.md");
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.id)).toEqual(["motoko", "togusa"]);
  });

  it("file not found: path doesn't exist → returns [] without throwing", async () => {
    mockEnoent();
    const members = await loadTeamMembers("/does/not/exist/team.md");
    expect(members).toEqual([]);
  });

  it("empty file: file exists but is empty → returns []", async () => {
    mockContent("");
    const members = await loadTeamMembers("/project/.squad/team.md");
    expect(members).toEqual([]);
  });

  it("no ## Members section: file has no Members heading → returns []", async () => {
    mockContent(`
# pi-squad

Some other content here.

## Decisions

- Use TypeScript
`.trim());

    const members = await loadTeamMembers("/project/.squad/team.md");
    expect(members).toEqual([]);
  });

  it("separator row skipped: row matching /^[:\\-\\s]+$/ per cell is not parsed as a member", async () => {
    // Provide a table where only the separator and header rows are present (no data rows)
    // If separator was parsed as a member it would appear in results
    mockContent(`
# Squad

## Members

| Agent | Role | Emoji | Skills |
|-------|------|-------|--------|
`.trim());

    const members = await loadTeamMembers("/project/.squad/team.md");
    // Separator row must not produce a member
    expect(members).toEqual([]);
  });

  it("header row skipped: row with 'Agent' as first cell is not parsed as a member", async () => {
    mockContent(`
# Squad

## Members

| Agent | Role | Emoji | Skills |
`.trim());

    const members = await loadTeamMembers("/project/.squad/team.md");
    // Header row must not produce a member
    expect(members).toEqual([]);
  });
});
