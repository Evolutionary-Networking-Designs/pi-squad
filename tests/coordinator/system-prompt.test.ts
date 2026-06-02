import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import {
  MAX_PROMPT_CHARS,
  SquadMissingError,
  getSystemPrompt,
} from "../../src/coordinator/system-prompt.js";

const TEAM_ROOT = "/repo";
const readFileMock = vi.mocked(readFile);

function createMissingError(filePath: string): Error & { code: string } {
  const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as Error & {
    code: string;
  };
  error.code = "ENOENT";
  return error;
}

function mockPromptFiles(options?: {
  team?: string | null;
  routing?: string | null;
  decisions?: string | null;
  squadAgent?: string | null;
}): void {
  const {
    team = "# Team\n\n- Saito",
    routing = "Route prompt work to Saito.",
    decisions = "# Decisions\n\n### 2026-06-01\nKeep prompts concise.",
    squadAgent = "# Squad Coordinator\n\nBase coordinator prompt.",
  } = options ?? {};

  readFileMock.mockImplementation(async (filePath) => {
    const normalizedPath = String(filePath);

    if (normalizedPath.endsWith("squad/.github/agents/squad.agent.md")) {
      if (squadAgent === null) {
        throw createMissingError(normalizedPath);
      }
      return squadAgent;
    }

    if (normalizedPath === `${TEAM_ROOT}/.squad/team.md`) {
      if (team === null) {
        throw createMissingError(normalizedPath);
      }
      return team;
    }

    if (normalizedPath === `${TEAM_ROOT}/.squad/routing.md`) {
      if (routing === null) {
        throw createMissingError(normalizedPath);
      }
      return routing;
    }

    if (normalizedPath === `${TEAM_ROOT}/.squad/decisions.md`) {
      if (decisions === null) {
        throw createMissingError(normalizedPath);
      }
      return decisions;
    }

    throw createMissingError(normalizedPath);
  });
}

describe("getSystemPrompt", () => {
  beforeEach(() => {
    readFileMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("assembles the coordinator prompt when all files are present", async () => {
    mockPromptFiles({
      squadAgent: "# Squad Coordinator\n\nAuthoritative prompt.",
      team: "# Team\n\n- Saito",
      routing: "Route prompt work to Saito.",
      decisions: "# Decisions\n\n### 2026-06-01\nKeep prompts concise.",
    });

    const prompt = await getSystemPrompt(TEAM_ROOT);

    expect(prompt).toContain("Authoritative prompt.");
    expect(prompt).toContain("## Current Team");
    expect(prompt).toContain("# Team");
    expect(prompt).toContain("## Routing Rules");
    expect(prompt).toContain("Route prompt work to Saito.");
    expect(prompt).toContain("## Recent Decisions");
    expect(prompt).toContain("Keep prompts concise.");
  });

  it("omits the routing section when routing.md is missing", async () => {
    mockPromptFiles({ routing: null });

    const prompt = await getSystemPrompt(TEAM_ROOT);

    expect(prompt).toContain("## Current Team");
    expect(prompt).not.toContain("## Routing Rules");
    expect(prompt).toContain("## Recent Decisions");
  });

  it("omits the decisions section when decisions.md is missing", async () => {
    mockPromptFiles({ decisions: null });

    const prompt = await getSystemPrompt(TEAM_ROOT);

    expect(prompt).toContain("## Current Team");
    expect(prompt).toContain("## Routing Rules");
    expect(prompt).not.toContain("## Recent Decisions");
  });

  it("throws SquadMissingError when squad.agent.md is missing", async () => {
    mockPromptFiles({ squadAgent: null });

    await expect(getSystemPrompt(TEAM_ROOT)).rejects.toBeInstanceOf(SquadMissingError);
  });

  it("truncates decisions before routing when the prompt exceeds the budget", async () => {
    const squadAgent = "# Squad Coordinator\n\nStable base prompt.";
    const team = "# Team\n\n- Saito";
    const routing = "Route prompt work to Saito.";
    const decisions = `# Decisions\n\n## Active Decisions\n\n### 2026-06-01\n${"D".repeat(
      MAX_PROMPT_CHARS,
    )}`;

    mockPromptFiles({ squadAgent, team, routing, decisions });

    const prompt = await getSystemPrompt(TEAM_ROOT);

    expect(prompt.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    expect(prompt).toContain("Stable base prompt.");
    expect(prompt).toContain("# Team");
    expect(prompt).toContain("## Routing Rules");
    expect(prompt).toContain(routing);
    expect(prompt).toContain("## Recent Decisions");
  });

  it("reads source files in parallel with Promise.all", () => {
    const source = readFileSync(
      new URL("../../src/coordinator/system-prompt.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("Promise.all([\n    readRequiredFile(SQUAD_AGENT_MD),");
  });
});
