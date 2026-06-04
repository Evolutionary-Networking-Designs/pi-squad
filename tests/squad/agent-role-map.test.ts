import { describe, expect, it } from "vitest";

import { agentRoleToBuiltin } from "../../src/squad/agent-role-map.js";
import type { AgentRole } from "../../src/squad/agent-role-map.js";

describe("agentRoleToBuiltin", () => {
  it("lead → planner", () => {
    expect(agentRoleToBuiltin("lead")).toBe("planner");
  });

  it("developer → worker", () => {
    expect(agentRoleToBuiltin("developer")).toBe("worker");
  });

  it("tester → reviewer", () => {
    expect(agentRoleToBuiltin("tester")).toBe("reviewer");
  });

  it("security → reviewer", () => {
    expect(agentRoleToBuiltin("security")).toBe("reviewer");
  });

  it("devops → worker", () => {
    expect(agentRoleToBuiltin("devops")).toBe("worker");
  });

  it("designer → worker", () => {
    expect(agentRoleToBuiltin("designer")).toBe("worker");
  });

  it("prompt-engineer → worker", () => {
    expect(agentRoleToBuiltin("prompt-engineer")).toBe("worker");
  });

  it("reviewer → reviewer", () => {
    expect(agentRoleToBuiltin("reviewer")).toBe("reviewer");
  });

  it("scribe → null (coordinator-side, never spawned)", () => {
    expect(agentRoleToBuiltin("scribe")).toBeNull();
  });

  it("covers all 9 AgentRole values", () => {
    const allRoles: AgentRole[] = [
      "lead", "developer", "tester", "security", "devops",
      "designer", "prompt-engineer", "reviewer", "scribe",
    ];
    expect(allRoles).toHaveLength(9);
    // Each call must return without throwing
    for (const role of allRoles) {
      expect(() => agentRoleToBuiltin(role)).not.toThrow();
    }
  });
});
