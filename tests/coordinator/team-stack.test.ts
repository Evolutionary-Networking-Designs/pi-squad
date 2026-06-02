import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import {
  buildTeamLevel,
  resolveTeamStack,
} from "../../src/coordinator/team-stack.js";
import { SquadMissingError } from "../../src/coordinator/system-prompt.js";

const existsSyncMock = vi.mocked(existsSync);
const readFileMock = vi.mocked(readFile);

function createMissingError(filePath: string): Error & { code: string } {
  const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as Error & {
    code: string;
  };
  error.code = "ENOENT";
  return error;
}

function mockFileSystem(files: Record<string, string>, existingPaths: readonly string[]): void {
  const pathSet = new Set(existingPaths);

  existsSyncMock.mockImplementation((filePath) => pathSet.has(String(filePath)));
  readFileMock.mockImplementation(async (filePath) => {
    const normalizedPath = String(filePath);
    const content = files[normalizedPath];
    if (content !== undefined) {
      return content;
    }
    throw createMissingError(normalizedPath);
  });
}

describe("team-stack", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    readFileMock.mockReset();
  });

  it("builds a team level from team.md content", async () => {
    const dirPath = "/repo/packages/docs";
    const teamPath = `${dirPath}/.squad/team.md`;
    const teamSource = `# Docs Team\n\n| Agent | Role |\n| --- | --- |\n| Iris | Writer |\n| Kade | Reviewer |\n`;

    mockFileSystem({ [teamPath]: teamSource }, []);

    const level = await buildTeamLevel(dirPath, "local");

    expect(level).toEqual({
      path: dirPath,
      squadPath: `${dirPath}/.squad`,
      level: "local",
      config: {
        name: "Docs Team",
        agents: ["Iris", "Kade"],
        defaultTier: undefined,
        skills: [],
        sourceHash: createHash("sha256").update(teamSource).digest("hex"),
      },
      routingPath: `${dirPath}/.squad/routing.md`,
      decisionsPath: `${dirPath}/.squad/decisions.md`,
      inboxPath: `${dirPath}/.squad/decisions/inbox`,
    });
  });

  it("returns a single-team stack when only one .squad/team.md is found", async () => {
    const cwd = "/repo/packages/docs";
    const teamPath = `${cwd}/.squad/team.md`;
    const teamSource = "# Docs Team\n\n| Agent |\n| --- |\n| Iris |\n";

    mockFileSystem(
      { [teamPath]: teamSource },
      [teamPath, `${cwd}/.git`],
    );

    const stack = await resolveTeamStack(cwd);

    expect(stack.isSingleTeam).toBe(true);
    expect(stack.local).toBe(stack.root);
    expect(stack.local.path).toBe(cwd);
    expect(stack.local.config.name).toBe("Docs Team");
    expect(stack.local.config.agents).toEqual(["Iris"]);
  });

  it("returns local and root teams when multiple .squad/team.md files are found", async () => {
    const cwd = "/repo/packages/docs";
    const localTeamPath = `${cwd}/.squad/team.md`;
    const middleTeamPath = "/repo/packages/.squad/team.md";
    const rootTeamPath = "/repo/.squad/team.md";

    mockFileSystem(
      {
        [localTeamPath]: "# Docs Team\n\n| Agent |\n| --- |\n| Iris |\n",
        [middleTeamPath]: "# Packages Team\n\n| Agent |\n| --- |\n| Rook |\n",
        [rootTeamPath]: "# Platform Team\n\n| Agent |\n| --- |\n| Ada |\n",
      },
      [localTeamPath, middleTeamPath, rootTeamPath, "/repo/.git"],
    );

    const stack = await resolveTeamStack(cwd);

    expect(stack.isSingleTeam).toBe(false);
    expect(stack.local.path).toBe(cwd);
    expect(stack.local.level).toBe("local");
    expect(stack.local.config.name).toBe("Docs Team");
    expect(stack.root.path).toBe("/repo");
    expect(stack.root.level).toBe("root");
    expect(stack.root.config.name).toBe("Platform Team");
  });

  it("produces a deterministic sourceHash for the same team.md content", async () => {
    const teamSource = "# Shared Team\n\n| Agent |\n| --- |\n| Iris |\n";

    mockFileSystem(
      {
        "/repo/a/.squad/team.md": teamSource,
        "/repo/b/.squad/team.md": teamSource,
      },
      [],
    );

    const [left, right] = await Promise.all([
      buildTeamLevel("/repo/a", "local"),
      buildTeamLevel("/repo/b", "local"),
    ]);

    expect(left.config.sourceHash).toBe(right.config.sourceHash);
  });

  it("throws SquadMissingError when no team stack can be resolved", async () => {
    mockFileSystem({}, ["/repo/.git"]);

    await expect(resolveTeamStack("/repo/packages/docs")).rejects.toBeInstanceOf(
      SquadMissingError,
    );
  });
});
