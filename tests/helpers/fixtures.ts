/**
 * Factory functions for .squad/ test fixtures.
 *
 * Fixtures are written to caller-supplied directories within the project.
 * Tests are responsible for creating and cleaning up the base directory.
 *
 * All fixture content follows OSS boundary rules:
 * - Neutral team names (Platform Team, Docs Team)
 * - Agent names from the GITS universe (Motoko, Batou, Togusa, etc.)
 * - No sovereign-only terminology, no real credentials
 *
 * @example
 * ```typescript
 * import { join } from "node:path";
 * import { mkdirSync, rmSync } from "node:fs";
 * import { fileURLToPath } from "node:url";
 * import { createMinimalSquadFixture } from '../helpers/index.js';
 *
 * const WORKSPACES = fileURLToPath(new URL("../workspaces", import.meta.url));
 *
 * let fixtureDir: string;
 * beforeEach(() => {
 *   fixtureDir = join(WORKSPACES, `test-${Date.now()}`);
 *   mkdirSync(fixtureDir, { recursive: true });
 * });
 * afterEach(() => rmSync(fixtureDir, { recursive: true, force: true }));
 *
 * it('loads team', async () => {
 *   await createMinimalSquadFixture(fixtureDir);
 *   // Then chdir or vi.mock to have the coordinator read from fixtureDir
 * });
 * ```
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface TeamMember {
  name: string;
  role: string;
  charter?: string;
  status?: "active" | "inactive";
}

export interface DecisionEntry {
  date: string;
  title: string;
  body: string;
}

export interface RoutingRule {
  pattern: string;
  agent: string;
}

export interface MinimalFixtureOptions {
  /** Project name for the fixture. Default: "Platform Team". */
  projectName?: string;
  /** Team members to include. Defaults to two-member GITS cast. */
  teamMembers?: TeamMember[];
  /** Decision entries. Defaults to one placeholder decision. */
  decisions?: DecisionEntry[];
  /** Override raw content of team.md (takes precedence over teamMembers). */
  teamContent?: string;
  /** Override raw content of decisions.md (takes precedence over decisions). */
  decisionsContent?: string;
}

export interface FullFixtureOptions extends MinimalFixtureOptions {
  /** Routing rules to include in routing.md. */
  routingRules?: RoutingRule[];
  /** Override raw content of routing.md. */
  routingContent?: string;
  /** Per-agent charter content keyed by agent name. */
  agentCharters?: Record<string, string>;
}

const DEFAULT_TEAM_MEMBERS: TeamMember[] = [
  { name: "Motoko", role: "Lead", status: "active" },
  { name: "Batou", role: "Extension Dev", status: "active" },
];

const DEFAULT_DECISIONS: DecisionEntry[] = [
  {
    date: "2026-01-01T00:00:00Z",
    title: "Use TypeScript strict mode",
    body: "All source files use TypeScript with strict: true for type safety.",
  },
];

const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  { pattern: "extension", agent: "Batou" },
  { pattern: "test", agent: "Togusa" },
];

function buildTeamMd(projectName: string, members: TeamMember[]): string {
  const rows = members
    .map((m) => {
      const charter = m.charter ?? `agents/${m.name.toLowerCase()}/charter.md`;
      const status = m.status ?? "active";
      return `| ${m.name} | ${m.role} | [charter](${charter}) | ${status} |`;
    })
    .join("\n");

  return `# Squad Team

> ${projectName}

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work and enforces handoffs. |

## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
${rows}

## Project Context

- **Project:** ${projectName}
- **Universe:** Ghost in the Shell — Section 9
`;
}

function buildDecisionsMd(decisions: DecisionEntry[]): string {
  const entries = decisions
    .map(
      (d) => `## ${d.date}: ${d.title}

${d.body}

---`,
    )
    .join("\n\n");

  return entries + "\n";
}

function buildRoutingMd(rules: RoutingRule[]): string {
  const lines = rules.map((r) => `- ${r.pattern} → ${r.agent}`).join("\n");

  return `# Routing

${lines}
`;
}

function buildAgentCharterMd(name: string, role: string): string {
  return `# ${name} — ${role}

## Responsibilities

- Own ${role.toLowerCase()} concerns for the project.

## Constraints

- Coordinate with team before cross-cutting changes.
`;
}

/**
 * Create a minimal .squad/ fixture: team.md + decisions.md only.
 *
 * @param dir - Base directory to create .squad/ within. Must already exist.
 * @returns The base directory path (same as input).
 */
export async function createMinimalSquadFixture(
  dir: string,
  options: MinimalFixtureOptions = {},
): Promise<string> {
  const {
    projectName = "Platform Team",
    teamMembers = DEFAULT_TEAM_MEMBERS,
    decisions = DEFAULT_DECISIONS,
    teamContent,
    decisionsContent,
  } = options;

  const squadDir = join(dir, ".squad");
  await mkdir(squadDir, { recursive: true });

  await writeFile(
    join(squadDir, "team.md"),
    teamContent ?? buildTeamMd(projectName, teamMembers),
    "utf8",
  );

  await writeFile(
    join(squadDir, "decisions.md"),
    decisionsContent ?? buildDecisionsMd(decisions),
    "utf8",
  );

  return dir;
}

/**
 * Create a full .squad/ fixture: team.md + decisions.md + routing.md + per-agent charters.
 *
 * @param dir - Base directory to create .squad/ within. Must already exist.
 * @returns The base directory path (same as input).
 */
export async function createFullSquadFixture(
  dir: string,
  options: FullFixtureOptions = {},
): Promise<string> {
  const {
    projectName = "Platform Team",
    teamMembers = DEFAULT_TEAM_MEMBERS,
    decisions = DEFAULT_DECISIONS,
    routingRules = DEFAULT_ROUTING_RULES,
    agentCharters,
    teamContent,
    decisionsContent,
    routingContent,
  } = options;

  await createMinimalSquadFixture(dir, { projectName, teamMembers, decisions, teamContent, decisionsContent });

  const squadDir = join(dir, ".squad");

  await writeFile(
    join(squadDir, "routing.md"),
    routingContent ?? buildRoutingMd(routingRules),
    "utf8",
  );

  const charters = agentCharters ?? buildDefaultCharters(teamMembers);
  for (const [agentName, charterContent] of Object.entries(charters)) {
    const agentDir = join(squadDir, "agents", agentName.toLowerCase());
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "charter.md"), charterContent, "utf8");
  }

  return dir;
}

function buildDefaultCharters(members: TeamMember[]): Record<string, string> {
  return Object.fromEntries(
    members.map((m) => [m.name, buildAgentCharterMd(m.name, m.role)]),
  );
}
