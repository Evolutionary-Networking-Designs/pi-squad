import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./team-stack.js", () => ({
  resolveTeamStack: vi.fn(),
}));

vi.mock("../squad/dispatch-builder.js", () => ({
  buildDispatchTable: vi.fn(),
}));

vi.mock("../squad/registry-loader.js", () => ({
  loadRegistryEntries: vi.fn(),
}));

vi.mock("./spawn.js", () => ({
  spawnSquadAgent: vi.fn(),
}));

const recoveryState = vi.hoisted(() => ({
  recover: vi.fn(async () => ({
    success: true,
    tokensFreed: 10,
    newPressureLevel: "NOMINAL",
    summary: "Recovered",
    requiresReinject: false,
  })),
  getAttemptHistory: vi.fn(() => []),
}));

vi.mock("../context/store.js", () => ({
  createSessionStore: vi.fn(async (squadPath: string) => ({ squadPath })),
}));

vi.mock("../context/recovery.js", () => ({
  DefaultRecoveryOrchestrator: vi.fn(function MockDefaultRecoveryOrchestrator() {
    return {
      recover: recoveryState.recover,
      getAttemptHistory: recoveryState.getAttemptHistory,
    };
  }),
}));

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { DispatchTable, TeamMember } from "./router.js";
import type { TeamStack } from "../types.js";
import type { RegistryEntry } from "../squad/registry-loader.js";
import { buildDispatchTable } from "../squad/dispatch-builder.js";
import { loadRegistryEntries } from "../squad/registry-loader.js";
import { createSessionStore } from "../context/store.js";
import { initializeCoordinator } from "./coordinator.js";
import { spawnSquadAgent } from "./spawn.js";
import { resolveTeamStack } from "./team-stack.js";

function createTeamStack(): TeamStack {
  const level = {
    path: "/repo",
    squadPath: "/repo/.squad",
    level: "root" as const,
    config: {
      name: "pi-squad",
      agents: ["batou"],
      skills: [],
      sourceHash: "hash",
    },
    routingPath: "/repo/.squad/routing.md",
    decisionsPath: "/repo/.squad/decisions.md",
    inboxPath: "/repo/.squad/decisions/inbox",
  };

  return {
    local: level,
    root: level,
    isSingleTeam: true,
  };
}

function createDispatchTable(members: TeamMember[]): DispatchTable {
  return {
    members: new Map(members.map((member) => [member.id, member])),
    rules: [],
    parsedAt: new Date(0).toISOString(),
    sourceHash: "dispatch-hash",
  };
}

function createPi(): ExtensionAPI {
  return {
    on: vi.fn(),
    appendEntry: vi.fn(),
  } as unknown as ExtensionAPI;
}

describe("CoordinatorImpl routing guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recoveryState.recover.mockClear();
    recoveryState.getAttemptHistory.mockClear();
    vi.mocked(resolveTeamStack).mockResolvedValue(createTeamStack());
    vi.mocked(loadRegistryEntries).mockResolvedValue([]);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes loaded registry entries into buildDispatchTable", async () => {
    const registryEntries: RegistryEntry[] = [{
      persistentName: "batou",
      role: "developer",
      universe: "ghost-in-the-shell",
      createdAt: new Date(0).toISOString(),
      legacyNamed: false,
      status: "active",
      piBuiltin: "worker",
    }];
    vi.mocked(loadRegistryEntries).mockResolvedValue(registryEntries);
    vi.mocked(buildDispatchTable).mockResolvedValue(createDispatchTable([]));

    const coordinator = await initializeCoordinator(createPi());
    await coordinator.getDispatchTable();

    expect(buildDispatchTable).toHaveBeenCalledWith("/repo", registryEntries);
  });

  it("returns a reassessment response for unknown agent ids before spawning", async () => {
    vi.mocked(buildDispatchTable).mockResolvedValue(createDispatchTable([]));
    const coordinator = await initializeCoordinator(createPi());

    await coordinator.route(
      JSON.stringify({ type: "agent_spawn", agentId: "ghost", prompt: "Investigate the bug" }),
      { sessionId: "session-1", cwd: "/repo" },
    );

    expect(spawnSquadAgent).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining("Agent 'ghost' not found in the Squad roster"),
    );
  });

  it("reassesses when a spawned agent emits charter_reject and forwards the resolved member", async () => {
    const batou: TeamMember = {
      id: "batou",
      name: "Batou",
      role: "Extension Developer",
      emoji: "",
      skills: ["typescript"],
      piBuiltin: "worker",
    };
    vi.mocked(buildDispatchTable).mockResolvedValue(createDispatchTable([batou]));
    vi.mocked(spawnSquadAgent).mockResolvedValue({
      kind: "reassess",
      request: {
        agentId: "batou",
        prompt: "Investigate",
        systemPrompt: "",
        piBuiltin: "worker",
        timeout: 5_000,
        sessionId: "session-2",
      },
      directive: {
        type: "charter_reject",
        agentId: "batou",
        reason: "Out of charter",
        suggestedAgent: "aramaki",
      },
      reason: "Agent 'batou' rejected the task: Out of charter Reassess and consider 'aramaki'.",
    });

    const coordinator = await initializeCoordinator(createPi());
    await coordinator.route(
      JSON.stringify({ type: "agent_spawn", agentId: "batou", prompt: "Investigate" }),
      { sessionId: "session-2", cwd: "/repo" },
    );

    expect(spawnSquadAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "batou" }),
      expect.objectContaining({ resolvedAgent: expect.objectContaining({ piBuiltin: "worker" }) }),
    );
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining("Agent 'batou' rejected the task: Out of charter"),
    );
  });

  it("passes the root .squad path into recovery when context pressure triggers recovery", async () => {
    const coordinator = await initializeCoordinator(createPi());

    await coordinator.assessContext("a".repeat(800_000));

    expect(createSessionStore).toHaveBeenCalledWith("/repo/.squad");
    expect(recoveryState.recover).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ teamRoot: "/repo/.squad" }),
    );
  });
});
