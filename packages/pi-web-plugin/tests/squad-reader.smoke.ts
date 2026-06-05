import path from "node:path";

import { describe, expect, it } from "vitest";

import { createSquadReader } from "../src/squad-reader.js";
import {
  buildDecisionsFixture,
  buildOrchestrationLogFixture,
  buildTeamFixture,
} from "./helpers/fixture-factory.js";
import { createMockIo } from "./helpers/mock-io.js";

const RUN = process.env.PISQUAD_WEB_SMOKE === "1";
const SQUAD_ROOT = ".squad";
const ORCHESTRATION_LOG_DIR = path.posix.join(SQUAD_ROOT, "orchestration-log");

describe.skipIf(!RUN)("pi-web-plugin smoke tests", () => {
  it("reads a team fixture through the injected squad reader", async () => {
    const { reader } = createFixtureReader({
      team: buildTeamFixture([
        { name: "Motoko", role: "Lead" },
        { name: "Proto", role: "Test System Engineer" },
      ]),
    });

    await expect(reader.readTeamRoster(SQUAD_ROOT)).resolves.toEqual([
      { name: "Motoko", role: "Lead" },
      { name: "Proto", role: "Test System Engineer" },
    ]);
  });

  it("reads the latest orchestration activity from an in-memory log fixture", async () => {
    const newest = new Date("2026-06-05T11:05:00.000Z");
    const older = new Date("2026-06-05T10:00:00.000Z");
    const { reader } = createFixtureReader({
      orchestrationLog: buildOrchestrationLogFixture([
        { agentName: "Batou", task: "Stabilize the panel shell", modifiedAt: older },
        { agentName: "Proto", task: "Wire the smoke harness", modifiedAt: newest },
      ]),
    });

    await expect(reader.readLatestActivity(SQUAD_ROOT)).resolves.toMatchObject({
      agentName: "Proto",
      task: "Wire the smoke harness",
      modifiedAt: newest.toISOString(),
    });
  });

  it("counts decisions from an in-memory decisions fixture", async () => {
    const { reader } = createFixtureReader({
      decisions: buildDecisionsFixture([
        { heading: "Adopt the smoke gate", detail: "Use PISQUAD_WEB_SMOKE for opt-in coverage." },
        { heading: "Preserve the injection seam", detail: "Keep createSquadReader testable without Pi." },
      ]),
    });

    await expect(reader.readDecisionCount(SQUAD_ROOT)).resolves.toBe(2);
  });

  it("returns graceful null-like values when files are missing", async () => {
    const { reader } = createFixtureReader();

    await expect(reader.readTeamRoster(SQUAD_ROOT)).resolves.toEqual([]);
    await expect(reader.readDecisionCount(SQUAD_ROOT)).resolves.toBeNull();
    await expect(reader.readLatestActivity(SQUAD_ROOT)).resolves.toBeNull();
  });
});

interface ReaderFixtureOptions {
  team?: string;
  decisions?: string;
  orchestrationLog?: Map<string, string>;
}

function createFixtureReader(options: ReaderFixtureOptions = {}) {
  const files = new Map<string, string>();
  const directories = new Map<string, Map<string, string>>();
  const modifiedAtByPath = new Map<string, string>();

  if (options.team !== undefined) {
    files.set(path.posix.join(SQUAD_ROOT, "team.md"), options.team);
  }

  if (options.decisions !== undefined) {
    files.set(path.posix.join(SQUAD_ROOT, "decisions.md"), options.decisions);
  }

  if (options.orchestrationLog !== undefined) {
    directories.set(ORCHESTRATION_LOG_DIR, options.orchestrationLog);
    for (const [fileName, content] of options.orchestrationLog.entries()) {
      const filePath = path.posix.join(ORCHESTRATION_LOG_DIR, fileName);
      files.set(filePath, content);
      const modifiedAt = content.match(/^\*\*Date:\*\*\s+(.+)$/mu)?.[1];
      if (modifiedAt !== undefined) {
        modifiedAtByPath.set(filePath, modifiedAt);
      }
    }
  }

  const io = createMockIo({ files, directories, modifiedAtByPath });
  return {
    ...io,
    reader: createSquadReader(io.readTextFileSafe, io.listDirectorySafe),
  };
}
