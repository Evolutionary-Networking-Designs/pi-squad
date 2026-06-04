import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("./team-loader.js", () => ({
  loadTeamMembers: vi.fn(),
}));

vi.mock("./routing.js", () => ({
  loadRoutingRules: vi.fn(),
}));

import { readFile } from "node:fs/promises";

import type { TeamMember } from "../coordinator/router.js";
import type { RegistryEntry } from "./registry-loader.js";
import { buildDispatchTable } from "./dispatch-builder.js";
import { loadRoutingRules } from "./routing.js";
import { loadTeamMembers } from "./team-loader.js";

function buildMember(id: string): TeamMember {
  return {
    id,
    name: id,
    role: "developer",
    emoji: "",
    skills: [],
  };
}

describe("buildDispatchTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFile).mockResolvedValue("");
    vi.mocked(loadTeamMembers).mockResolvedValue([buildMember("batou")]);
    vi.mocked(loadRoutingRules).mockResolvedValue([]);
  });

  it("merges piBuiltin from matching registry entries", async () => {
    const registryEntries: RegistryEntry[] = [{
      persistentName: "Batou",
      role: "developer",
      universe: "ghost-in-the-shell",
      createdAt: new Date(0).toISOString(),
      legacyNamed: false,
      status: "active",
      piBuiltin: "worker",
    }];

    const table = await buildDispatchTable("/repo", registryEntries);

    expect(table.members.get("batou")?.piBuiltin).toBe("worker");
  });

  it("leaves piBuiltin undefined when registry entries are omitted", async () => {
    const table = await buildDispatchTable("/repo");

    expect(table.members.get("batou")?.piBuiltin).toBeUndefined();
  });

  it("ignores registry entries that do not match a team member id", async () => {
    const registryEntries: RegistryEntry[] = [{
      persistentName: "motoko",
      role: "lead",
      universe: "ghost-in-the-shell",
      createdAt: new Date(0).toISOString(),
      legacyNamed: false,
      status: "active",
      piBuiltin: "planner",
    }];

    const table = await buildDispatchTable("/repo", registryEntries);

    expect(table.members.get("batou")?.piBuiltin).toBeUndefined();
    expect(table.members.has("motoko")).toBe(false);
  });
});
