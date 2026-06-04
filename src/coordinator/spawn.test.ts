import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
}));

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { spawnSquadAgent } from "./spawn.js";

function createPi(execImpl: ExtensionAPI["exec"]): ExtensionAPI {
  return {
    exec: execImpl,
    getDefaultModel: () => "gpt-5.5",
  } as unknown as ExtensionAPI;
}

describe("spawnSquadAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);
  });

  it("drops --no-extensions and carries piBuiltin into the spawned prompt overlay", async () => {
    vi.mocked(readFile).mockResolvedValue("# Batou\nStay in charter." as never);
    const exec = vi.fn<ExtensionAPI["exec"]>().mockResolvedValue({
      code: 0,
      stdout: "ok",
      stderr: "",
    } as Awaited<ReturnType<ExtensionAPI["exec"]>>);

    const result = await spawnSquadAgent(
      {
        type: "agent_spawn",
        agentId: "batou",
        prompt: "Implement the routing fix",
        timeoutMs: 5_000,
      },
      {
        pi: createPi(exec),
        sessionId: "session-123",
        cwd: "/repo",
        resolvedAgent: { piBuiltin: "worker" },
      },
    );

    expect(result.request.piBuiltin).toBe("worker");
    expect(exec).toHaveBeenCalledWith(
      "pi",
      expect.not.arrayContaining(["--no-extensions"]),
      expect.objectContaining({ cwd: "/repo", timeout: 5_000 }),
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining("batou-system.md"),
      expect.stringContaining("pi-subagents built-in `worker` execution path"),
      expect.objectContaining({ encoding: "utf8", mode: 0o600 }),
    );
  });

  it("returns a reassessment result when the child emits a charter_reject directive", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("missing charter"));
    const exec = vi.fn<ExtensionAPI["exec"]>().mockResolvedValue({
      code: 0,
      stdout: '{"type":"message_end","message":{"content":[{"type":"text","text":"{\\"type\\":\\"charter_reject\\",\\"agentId\\":\\"batou\\",\\"reason\\":\\"Out of scope\\",\\"suggestedAgent\\":\\"aramaki\\"}"}]}}',
      stderr: "",
    } as Awaited<ReturnType<ExtensionAPI["exec"]>>);

    const result = await spawnSquadAgent(
      {
        type: "agent_spawn",
        agentId: "batou",
        prompt: "Review deployment policy",
      },
      {
        pi: createPi(exec),
        sessionId: "session-456",
        cwd: "/repo",
        resolvedAgent: { piBuiltin: "reviewer" },
      },
    );

    expect(result.kind).toBe("reassess");
    if (result.kind !== "reassess") {
      throw new Error("Expected reassess result");
    }
    expect(result.directive.suggestedAgent).toBe("aramaki");
    expect(result.reason).toContain("Out of scope");
    expect(result.reason).toContain("aramaki");
  });
});
