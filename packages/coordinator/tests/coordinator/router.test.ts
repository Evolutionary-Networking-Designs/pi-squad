import { describe, expect, it } from "vitest";

import {
  routeLocal,
  routeWithEscalation,
  type DispatchTable,
  type RoutingRule,
  type TeamMember,
} from "../../src/coordinator/router.js";

function createMember(id: string, name: string): TeamMember {
  return {
    id,
    name,
    role: `${name} role`,
    emoji: "🧪",
    skills: [],
  };
}

function createRule(
  pattern: RoutingRule["pattern"],
  agentId: string,
  priority = 100,
  conditions?: RoutingRule["conditions"],
): RoutingRule {
  return { pattern, agentId, priority, conditions };
}

function createTable(overrides: Partial<DispatchTable> = {}): DispatchTable {
  const docs = createMember("docs", "Iris");
  const backend = createMember("backend", "Ada");

  return {
    members: new Map([
      [docs.id, docs],
      [backend.id, backend],
    ]),
    rules: [createRule("docs", "docs"), createRule(/auth/i, "backend")],
    parsedAt: "2026-06-01T00:00:00.000Z",
    sourceHash: "dispatch-hash",
    ...overrides,
  };
}

describe("router", () => {
  it("routeLocal matches rules and enforces conditions", () => {
    const table = createTable({
      rules: [
        createRule("docs", "docs", 100, {
          filePatterns: ["docs/**/*.md"],
          labels: ["documentation"],
          custom: "allow-docs",
        }),
      ],
    });

    expect(routeLocal(table, "docs task")).toBeNull();

    const route = routeLocal(table, "docs task", {
      filePaths: ["docs/guide/getting-started.md"],
      labels: ["documentation"],
      custom: { "allow-docs": true },
    });

    expect(route).toEqual({
      agent: table.members.get("docs"),
      matchedRule: table.rules[0],
      confidence: 0.9,
    });
  });

  it("routeWithEscalation falls back to the parent dispatch table", () => {
    const parent = createTable({
      rules: [createRule(/auth/i, "backend")],
    });
    const local = createTable({
      rules: [createRule("docs", "docs")],
      parent,
    });

    const route = routeWithEscalation(local, "auth regression in login flow");

    expect(route).toEqual({
      agent: parent.members.get("backend"),
      matchedRule: parent.rules[0],
      confidence: 1,
      escalatedTo: "root",
    });
  });
});
