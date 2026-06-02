/**
 * @module coordinator/team-stack
 * Resolves the multi-team stack by walking up from cwd to find all .squad/ directories.
 *
 * Algorithm:
 * 1. Start at cwd (default: process.cwd())
 * 2. Walk up, collecting every dir that has .squad/team.md
 * 3. Stop at git root (presence of .git/) or filesystem root
 * 4. If only one .squad/ found → isSingleTeam: true (local === root, backward compat)
 * 5. If two or more → innermost = local, outermost = root
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { TeamConfig, TeamLevel, TeamStack } from "../types.js";
import { SquadMissingError } from "./system-prompt.js";

const SQUAD_DIRNAME = ".squad";
const TEAM_FILENAME = "team.md";
const ROUTING_FILENAME = "routing.md";
const DECISIONS_FILENAME = "decisions.md";
const DECISIONS_DIRNAME = "decisions";
const INBOX_DIRNAME = "inbox";

function getSquadPath(dirPath: string): string {
  return join(dirPath, SQUAD_DIRNAME);
}

function getTeamPath(dirPath: string): string {
  return join(getSquadPath(dirPath), TEAM_FILENAME);
}

function hasTeamConfig(dirPath: string): boolean {
  return existsSync(getTeamPath(dirPath));
}

function isGitRoot(dirPath: string): boolean {
  return existsSync(join(dirPath, ".git"));
}

function parseTeamName(teamSource: string, dirPath: string): string {
  const heading = teamSource
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));

  return heading ? heading.slice(2).trim() : basename(dirPath);
}

function parseAgents(teamSource: string): readonly string[] {
  const agents: string[] = [];

  for (const line of teamSource.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
      continue;
    }

    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    const firstCell = cells[0];
    if (!firstCell) {
      continue;
    }

    if (/^[:\-\s]+$/u.test(firstCell)) {
      continue;
    }

    if (/^(agent|member|name)$/iu.test(firstCell)) {
      continue;
    }

    agents.push(firstCell);
  }

  return agents;
}

function buildTeamConfig(dirPath: string, teamSource: string): TeamConfig {
  return {
    name: parseTeamName(teamSource, dirPath),
    agents: parseAgents(teamSource),
    defaultTier: undefined,
    skills: [],
    sourceHash: createHash("sha256").update(teamSource).digest("hex"),
  };
}

export async function buildTeamLevel(
  dirPath: string,
  level: "root" | "local",
): Promise<TeamLevel> {
  const path = resolve(dirPath);
  const squadPath = getSquadPath(path);
  const teamPath = getTeamPath(path);
  const teamSource = await readFile(teamPath, "utf8");

  return {
    path,
    squadPath,
    level,
    config: buildTeamConfig(path, teamSource),
    routingPath: join(squadPath, ROUTING_FILENAME),
    decisionsPath: join(squadPath, DECISIONS_FILENAME),
    inboxPath: join(squadPath, DECISIONS_DIRNAME, INBOX_DIRNAME),
  };
}

export async function resolveTeamStack(cwd: string = process.cwd()): Promise<TeamStack> {
  const startDir = resolve(cwd);
  const discoveredDirs: string[] = [];

  let currentDir = startDir;
  while (true) {
    if (hasTeamConfig(currentDir)) {
      discoveredDirs.push(currentDir);
    }

    const parentDir = dirname(currentDir);
    if (isGitRoot(currentDir) || parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  if (discoveredDirs.length === 0) {
    throw new SquadMissingError(getTeamPath(startDir));
  }

  const localDir = discoveredDirs[0];
  const rootDir = discoveredDirs[discoveredDirs.length - 1];

  if (localDir === rootDir) {
    const team = await buildTeamLevel(localDir, "root");
    return {
      local: team,
      root: team,
      isSingleTeam: true,
    };
  }

  const [local, root] = await Promise.all([
    buildTeamLevel(localDir, "local"),
    buildTeamLevel(rootDir, "root"),
  ]);

  return {
    local,
    root,
    isSingleTeam: false,
  };
}
