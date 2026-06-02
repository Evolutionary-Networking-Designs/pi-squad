import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import {
  CompositePromptError,
  TRUNCATION_ORDER,
  getCompositeSystemPrompt,
} from "../../src/coordinator/composite-prompt.js";
import type { TeamStack } from "../../src/types.js";

const readFileMock = vi.mocked(readFile);

function createMissingError(filePath: string): Error & { code: string } {
  const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as Error & {
    code: string;
  };
  error.code = "ENOENT";
  return error;
}

function createStack(): TeamStack {
  return {
    isSingleTeam: false,
    root: {
      path: "/repo",
      squadPath: "/repo/.squad",
      level: "root",
      config: {
        name: "Platform Team",
        agents: ["Ada"],
        skills: [],
        sourceHash: "root-hash",
      },
      routingPath: "/repo/.squad/routing.md",
      decisionsPath: "/repo/.squad/decisions.md",
      inboxPath: "/repo/.squad/decisions/inbox",
    },
    local: {
      path: "/repo/packages/docs",
      squadPath: "/repo/packages/docs/.squad",
      level: "local",
      config: {
        name: "Docs Team",
        agents: ["Iris"],
        skills: [],
        sourceHash: "local-hash",
      },
      routingPath: "/repo/packages/docs/.squad/routing.md",
      decisionsPath: "/repo/packages/docs/.squad/decisions.md",
      inboxPath: "/repo/packages/docs/.squad/decisions/inbox",
    },
  };
}

function mockFiles(files: Record<string, string | null>): void {
  readFileMock.mockImplementation(async (filePath) => {
    const normalizedPath = String(filePath);
    if (Object.prototype.hasOwnProperty.call(files, normalizedPath)) {
      const content = files[normalizedPath];
      if (content === null) {
        throw createMissingError(normalizedPath);
      }
      return content;
    }

    throw createMissingError(normalizedPath);
  });
}

describe("composite-prompt", () => {
  beforeEach(() => {
    readFileMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns the root prompt unchanged for single-team stacks", async () => {
    const stack = {
      ...createStack(),
      isSingleTeam: true,
    } satisfies TeamStack;
    const agentMd = [
      "# Squad Coordinator",
      "",
      "Global governance.",
      "",
      "### Coordinator Identity",
      "You are the docs coordinator.",
      "---",
      "",
      "Always be concise.",
    ].join("\n");

    mockFiles({
      "/repo/.squad/team.md": "# Platform Team\n\n- Ada",
      "/repo/.squad/routing.md": "Route prompt work to Ada.",
      "/repo/.squad/decisions.md": "# Decisions\n\nKeep things tidy.",
    });

    const prompt = await getCompositeSystemPrompt(stack, agentMd, 10_000);

    expect(prompt).toBe([
      agentMd.trim(),
      "---\n## Current Team\n# Platform Team\n\n- Ada",
      "---\n## Routing Rules\nRoute prompt work to Ada.",
      "---\n## Recent Decisions\n# Decisions\n\nKeep things tidy.",
    ].join("\n\n"));
    expect(prompt).not.toContain("Team Context (Root)");
    expect(prompt).not.toContain("Team Context (Local)");
  });

  it("assembles multi-team sections in governance, root, then local order", async () => {
    const stack = createStack();
    const agentMd = [
      "# Squad Coordinator",
      "Global governance.",
      "",
      "### Coordinator Identity",
      "You are the docs coordinator.",
      "---",
      "",
      "Follow escalation rules.",
    ].join("\n");

    mockFiles({
      "/repo/.squad/team.md": "# Platform Team\n\n- Ada",
      "/repo/packages/docs/.squad/team.md": "# Docs Team\n\n- Iris",
      "/repo/.squad/routing.md": "Root routing.",
      "/repo/packages/docs/.squad/routing.md": "Local routing.",
      "/repo/.squad/decisions.md": "Root decisions.",
      "/repo/packages/docs/.squad/decisions.md": "Local decisions.",
    });

    const prompt = await getCompositeSystemPrompt(stack, agentMd, 10_000);

    expect(prompt.indexOf("# Squad Coordinator\nGlobal governance.")).toBeGreaterThanOrEqual(0);
    expect(prompt.indexOf("### Coordinator Identity\nYou are the docs coordinator.")).toBeGreaterThan(
      prompt.indexOf("# Squad Coordinator\nGlobal governance."),
    );
    expect(prompt.indexOf("## Team Context (Root)")).toBeGreaterThan(
      prompt.indexOf("### Coordinator Identity\nYou are the docs coordinator."),
    );
    expect(prompt.indexOf("## Routing (Root)")).toBeGreaterThan(
      prompt.indexOf("## Team Context (Root)"),
    );
    expect(prompt.indexOf("## Decisions (Root)")).toBeGreaterThan(
      prompt.indexOf("## Routing (Root)"),
    );
    expect(prompt.indexOf("## Team Context (Local: Docs Team)")).toBeGreaterThan(
      prompt.indexOf("## Decisions (Root)"),
    );
    expect(prompt.indexOf("## Routing (Local)")).toBeGreaterThan(
      prompt.indexOf("## Team Context (Local: Docs Team)"),
    );
    expect(prompt.indexOf("## Decisions (Local)")).toBeGreaterThan(
      prompt.indexOf("## Routing (Local)"),
    );
  });

  it("drops optional sections in TRUNCATION_ORDER when the budget is exceeded", async () => {
    const stack = createStack();
    const agentMd = "# Squad Coordinator\n\nGovernance.";

    mockFiles({
      "/repo/.squad/team.md": "# Platform Team\n\n- Ada",
      "/repo/packages/docs/.squad/team.md": "# Docs Team\n\n- Iris",
      "/repo/.squad/routing.md": `Root routing ${"R".repeat(200)}`,
      "/repo/packages/docs/.squad/routing.md": `Local routing ${"L".repeat(200)}`,
      "/repo/.squad/decisions.md": `Root decisions ${"D".repeat(200)}`,
      "/repo/packages/docs/.squad/decisions.md": `Local decisions ${"E".repeat(200)}`,
    });

    const prompt = await getCompositeSystemPrompt(stack, agentMd, 80);

    expect(prompt).toContain("# Squad Coordinator");
    expect(prompt).toContain("## Team Context (Root)");
    expect(prompt).toContain("## Team Context (Local: Docs Team)");
    for (const section of [
      "## Decisions (Root)",
      "## Decisions (Local)",
      "## Routing (Root)",
      "## Routing (Local)",
    ]) {
      expect(prompt).not.toContain(section);
    }
    expect(console.warn).toHaveBeenCalledWith(
      `[pi-squad] Truncated composite coordinator prompt to fit budget. Dropped sections: ${TRUNCATION_ORDER.join(", ")}.`,
    );
  });

  it("throws CompositePromptError when required input is missing", async () => {
    const stack = createStack();

    mockFiles({
      "/repo/.squad/team.md": null,
      "/repo/packages/docs/.squad/team.md": "# Docs Team\n\n- Iris",
      "/repo/.squad/routing.md": null,
      "/repo/packages/docs/.squad/routing.md": null,
      "/repo/.squad/decisions.md": null,
      "/repo/packages/docs/.squad/decisions.md": null,
    });

    await expect(getCompositeSystemPrompt(stack, "   ")).rejects.toEqual(
      expect.objectContaining<Partial<CompositePromptError>>({
        name: "CompositePromptError",
        missingSections: ["governance", "root.team"],
      }),
    );
  });
});
