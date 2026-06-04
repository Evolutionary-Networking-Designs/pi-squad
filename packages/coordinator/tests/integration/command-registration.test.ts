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

describe.sequential("/squad command integration", () => {
  let originalCwd = process.cwd();
  let workspaceDir = "";
  let sessionHandle: TestSession | undefined;

  beforeEach(async () => {
    originalCwd = process.cwd();
    workspaceDir = createWorkspacePath("command-registration");
    await mkdir(workspacesRoot, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });
    await createFullSquadFixture(workspaceDir);
    process.chdir(workspaceDir);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    sessionHandle = await createTestSession({ squadDir: process.cwd() });
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

  it("registers /squad in the live session", () => {
    expect(sessionHandle!.hasCommand("squad")).toBe(true);
  });

  it("surfaces a non-empty /squad description", () => {
    const desc = sessionHandle!.getCommandDescription("squad");
    expect(typeof desc).toBe("string");
    expect((desc ?? "").length).toBeGreaterThan(0);
  });

  it("executes /squad without falling through to the model", async () => {
    sessionHandle!.faux?.setResponses([fauxText("ok")]);
    await expect(sessionHandle!.session.prompt("/squad status")).resolves.toBeUndefined();
  });
});
