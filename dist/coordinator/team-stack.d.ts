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
import type { TeamLevel, TeamStack } from "../types.js";
export declare function buildTeamLevel(dirPath: string, level: "root" | "local"): Promise<TeamLevel>;
export declare function resolveTeamStack(cwd?: string): Promise<TeamStack>;
//# sourceMappingURL=team-stack.d.ts.map