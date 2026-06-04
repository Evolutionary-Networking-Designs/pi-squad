import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { fauxText } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFullSquadFixture,
  createMinimalSquadFixture,
  createTestSession,
  type TestSession,
} from "../helpers/index.js";

const workspacesRoot = fileURLToPath(new URL("../workspaces", import.meta.url));

function createWorkspacePath(prefix: string): string {
  return join(workspacesRoot, `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

describe.sequential("coordinator graceful degradation", () => {
  let originalCwd = process.cwd();
  let workspaceDir = "";
  let sessionHandle: TestSession | undefined;

  beforeEach(async () => {
    originalCwd = process.cwd();
    workspaceDir = createWorkspacePath("graceful-degradation");
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

  it("initializes a session without throwing when .squad is missing", async () => {
    await mkdir(workspaceDir, { recursive: true });
    process.chdir(workspaceDir);

    await expect(createSession()).resolves.toMatchObject({
      session: expect.any(Object),
      cleanup: expect.any(Function),
    });
  });

  it("completes prompt() without throwing when team.md is absent", async () => {
    await mkdir(workspaceDir, { recursive: true });
    process.chdir(workspaceDir);

    const ts = await createSession();
    ts.faux?.setResponses([fauxText("ok")]);

    await expect(ts.session.prompt("hello without team")).resolves.toBeUndefined();
    expect(ts.systemPrompt()).not.toBe("");
  });

  it("keeps a populated prompt when .squad/team.md is empty", async () => {
    await mkdir(workspaceDir, { recursive: true });
    await createMinimalSquadFixture(workspaceDir, { teamContent: "" });
    process.chdir(workspaceDir);

    const ts = await createSession();
    ts.faux?.setResponses([fauxText("ok")]);
    await expect(ts.session.prompt("hello with empty team")).resolves.toBeUndefined();

    const prompt = ts.systemPrompt();
    expect(prompt).not.toBe("");
  });

  it("keeps a populated prompt when team.md content is malformed", async () => {
    await mkdir(workspaceDir, { recursive: true });
    await createFullSquadFixture(workspaceDir, {
      teamContent: "# Broken Team\n\nThis is not a roster table.",
    });
    process.chdir(workspaceDir);

    const ts = await createSession();
    ts.faux?.setResponses([fauxText("ok")]);
    await expect(ts.session.prompt("hello with malformed team")).resolves.toBeUndefined();

    const prompt = ts.systemPrompt();
    expect(prompt).not.toBe("");
  });
});
