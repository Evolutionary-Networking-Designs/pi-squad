import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";
import { loadAgentCharter, loadAllCharters } from "../../src/squad/charter.js";

// Helpers to keep mock setup terse without using `any`
function mockContent(content: string): void {
  vi.mocked(readFile).mockResolvedValue(content as unknown as Buffer);
}

function mockEnoent(): void {
  vi.mocked(readFile).mockRejectedValue(
    Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" }),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("loadAgentCharter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: charter file exists → returns its string content", async () => {
    const charter = "# Batou\n\nExtension dev. Owns TypeScript integration.";
    mockContent(charter);

    const result = await loadAgentCharter("/root", "batou");
    expect(result).toBe(charter);
  });

  it("missing file: file doesn't exist → returns undefined without throwing", async () => {
    mockEnoent();

    const result = await loadAgentCharter("/root", "batou");
    expect(result).toBeUndefined();
  });

  it("empty charter: file exists but is empty → returns '' (not undefined)", async () => {
    mockContent("");

    const result = await loadAgentCharter("/root", "batou");
    expect(result).toBe("");
    expect(result).not.toBeUndefined();
  });

  it("path construction: resolves to {squadRoot}/.squad/agents/{agentId}/charter.md", async () => {
    mockContent("charter content");

    await loadAgentCharter("/my/project", "togusa");

    const expectedPath = path.join("/my/project", ".squad", "agents", "togusa", "charter.md");
    expect(vi.mocked(readFile)).toHaveBeenCalledWith(expectedPath, expect.anything());
  });
});

describe("loadAllCharters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a Map with all 3 charters loaded when all files exist", async () => {
    vi.mocked(readFile)
      .mockResolvedValueOnce("motoko charter" as unknown as Buffer)
      .mockResolvedValueOnce("batou charter" as unknown as Buffer)
      .mockResolvedValueOnce("togusa charter" as unknown as Buffer);

    const result = await loadAllCharters("/root", ["motoko", "batou", "togusa"]);

    expect(result.size).toBe(3);
    expect(result.get("motoko")).toBe("motoko charter");
    expect(result.get("batou")).toBe("batou charter");
    expect(result.get("togusa")).toBe("togusa charter");
  });

  it("partial miss: 2 of 3 files exist → Map has only 2 entries (missing agent excluded)", async () => {
    vi.mocked(readFile)
      .mockResolvedValueOnce("motoko charter" as unknown as Buffer)
      .mockRejectedValueOnce(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      )
      .mockResolvedValueOnce("togusa charter" as unknown as Buffer);

    const result = await loadAllCharters("/root", ["motoko", "batou", "togusa"]);

    expect(result.size).toBe(2);
    expect(result.has("motoko")).toBe(true);
    expect(result.has("batou")).toBe(false);
    expect(result.has("togusa")).toBe(true);
  });
});
