import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { fauxText } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFullSquadFixture,
  createTestSession,
  type TestSession,
} from "../helpers/index.js";

const workspacesRoot = fileURLToPath(new URL("../workspaces", import.meta.url));

function createWorkspacePath(prefix: string): string {
  return join(workspacesRoot, `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

describe.sequential("before_agent_start hook integration", () => {
  let originalCwd = process.cwd();
  let workspaceDir = "";
  let sessionHandle: TestSession | undefined;

  beforeEach(async () => {
    originalCwd = process.cwd();
    workspaceDir = createWorkspacePath("hook-injection");
    await mkdir(workspacesRoot, { recursive: true });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    sessionHandle?.cleanup();
    sessionHandle = undefined;
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    if (workspaceDir) {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  async function createSession(): Promise<TestSession> {
    sessionHandle = await createTestSession({ squadDir: process.cwd() });
    return sessionHandle;
  }

  it("injects Squad coordinator content after prompt() fires the before_agent_start hook", async () => {
    await mkdir(workspaceDir, { recursive: true });
    await createFullSquadFixture(workspaceDir);
    process.chdir(workspaceDir);

    const ts = await createSession();
    ts.faux?.setResponses([fauxText("ok")]);
    await ts.session.prompt("hello squad");

    expect(ts.systemPrompt()).toContain("Squad Coordinator");
    expect(ts.systemPrompt()).toContain("Platform Team");
  });

  it("falls back cleanly when .squad is missing — hook still injects base coordinator header", async () => {
    await mkdir(workspaceDir, { recursive: true });
    process.chdir(workspaceDir);

    const ts = await createSession();
    ts.faux?.setResponses([fauxText("ok")]);
    await ts.session.prompt("hello from empty workspace");

    expect(ts.systemPrompt()).toContain("Squad Coordinator");
  });

  it("keeps the injected coordinator prompt stable across multiple prompts", async () => {
    await mkdir(workspaceDir, { recursive: true });
    await createFullSquadFixture(workspaceDir);
    process.chdir(workspaceDir);

    const ts = await createSession();
    ts.faux?.setResponses([fauxText("ok")]);
    await ts.session.prompt("first prompt");
    const firstPrompt = ts.systemPrompt();

    ts.faux?.setResponses([fauxText("ok")]);
    await ts.session.prompt("second prompt");

    expect(ts.systemPrompt()).toBe(firstPrompt);
    expect(ts.systemPrompt()).toContain("Squad Coordinator");
  });
});
