import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

import {
  MAX_PROMPT_CHARS,
  SquadMissingError,
  TWO_TIER_DESCRIPTION,
  buildWorkflowSection,
  getSystemPrompt,
} from "../../src/coordinator/system-prompt.js";

const TEAM_ROOT = "/repo";
const readFileMock = vi.mocked(readFile);
const readdirMock = vi.mocked(readdir);

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
  promptFiles?: Record<string, string>;
}): void {
  const {
    team = "# Team\n\n- Saito",
    routing = "Route prompt work to Saito.",
    decisions = "# Decisions\n\n### 2026-06-01\nKeep prompts concise.",
    squadAgent = "# Squad Coordinator\n\nBase coordinator prompt.",
    promptFiles = {},
  } = options ?? {};

  // readdir returns empty list by default — workflow section is gracefully omitted
  readdirMock.mockResolvedValue(Object.keys(promptFiles) as never);

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

    // Prompt template files
    for (const [filename, content] of Object.entries(promptFiles)) {
      if (normalizedPath.endsWith(`/${filename}`)) {
        return content;
      }
    }

    throw createMissingError(normalizedPath);
  });
}

describe("getSystemPrompt", () => {
  beforeEach(() => {
    readFileMock.mockReset();
    readdirMock.mockReset();
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

  it("includes TWO_TIER_DESCRIPTION in the assembled prompt", async () => {
    mockPromptFiles();

    const prompt = await getSystemPrompt(TEAM_ROOT);

    expect(prompt).toContain("## Execution Architecture");
    expect(prompt).toContain("Team personas");
    expect(prompt).toContain("scout");
    expect(prompt).toContain("researcher");
    expect(prompt).toContain("context-builder");
  });

  it("includes workflow shortcuts section when prompts directory has md files", async () => {
    mockPromptFiles({
      promptFiles: {
        "parallel-review.md": "---\ndescription: Parallel subagents review\n---\nContent.",
        "review-loop.md": "---\ndescription: Review/fix loop until clean\n---\nContent.",
        "parallel-research.md": "---\ndescription: Parallel subagents research\n---\nContent.",
      },
    });

    const prompt = await getSystemPrompt(TEAM_ROOT);

    expect(prompt).toContain("## Workflow Shortcuts");
    expect(prompt).toContain("parallel-review");
    expect(prompt).toContain("Parallel subagents review");
    expect(prompt).toContain("review-loop");
    expect(prompt).toContain("Review/fix loop until clean");
    expect(prompt).toContain("parallel-research");
    expect(prompt).toContain("subagent()");
  });

  it("omits workflow shortcuts section when prompts directory is empty", async () => {
    mockPromptFiles({ promptFiles: {} });

    const prompt = await getSystemPrompt(TEAM_ROOT);

    expect(prompt).not.toContain("## Workflow Shortcuts");
  });
});

describe("TWO_TIER_DESCRIPTION", () => {
  it("describes the persona/execution-primitive split", () => {
    expect(TWO_TIER_DESCRIPTION).toContain("## Execution Architecture");
    expect(TWO_TIER_DESCRIPTION).toContain("personas");
    expect(TWO_TIER_DESCRIPTION).toContain("scout");
    expect(TWO_TIER_DESCRIPTION).toContain("researcher");
    expect(TWO_TIER_DESCRIPTION).toContain("context-builder");
  });
});

describe("buildWorkflowSection", () => {
  beforeEach(() => {
    readFileMock.mockReset();
    readdirMock.mockReset();
  });

  it("returns empty string when prompts directory cannot be read", async () => {
    readdirMock.mockRejectedValue(new Error("ENOENT"));

    const result = await buildWorkflowSection();

    expect(result).toBe("");
  });

  it("returns empty string when directory has no md files", async () => {
    readdirMock.mockResolvedValue([] as never);

    const result = await buildWorkflowSection();

    expect(result).toBe("");
  });

  it("lists workflow names and descriptions sorted alphabetically", async () => {
    readdirMock.mockResolvedValue(["review-loop.md", "parallel-review.md"] as never);
    readFileMock.mockImplementation(async (filePath) => {
      const p = String(filePath);
      if (p.endsWith("parallel-review.md"))
        return "---\ndescription: Parallel subagents review\n---";
      if (p.endsWith("review-loop.md")) return "---\ndescription: Review/fix loop until clean\n---";
      throw new Error(`unexpected: ${p}`);
    });

    const result = await buildWorkflowSection();

    expect(result).toContain("## Workflow Shortcuts");
    expect(result).toContain("**parallel-review**");
    expect(result).toContain("Parallel subagents review");
    expect(result).toContain("**review-loop**");
    expect(result).toContain("Review/fix loop until clean");
    // alphabetical order: parallel-review before review-loop
    expect(result.indexOf("parallel-review")).toBeLessThan(result.indexOf("review-loop"));
  });
});
