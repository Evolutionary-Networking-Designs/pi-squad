import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";
import type { RoutingRule } from "../../src/coordinator/router.js";
import { loadRoutingRules } from "../../src/squad/routing.js";

// Helpers to keep mock setup terse without using `any`
function mockContent(content: string): void {
  vi.mocked(readFile).mockResolvedValue(content as unknown as Buffer);
}

function mockEnoent(): void {
  vi.mocked(readFile).mockRejectedValue(
    Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" }),
  );
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WELL_FORMED_ROUTING_MD = `
# Routing Rules

## Rules

| Pattern | Agent | Priority |
|---------|-------|----------|
| test.*|togusa|100|
| *.ts|batou|50|
`.trim();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("loadRoutingRules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: parses routing.md with 2 rules → returns 2 RoutingRule objects", async () => {
    mockContent(WELL_FORMED_ROUTING_MD);
    const rules = await loadRoutingRules("/project/.squad/routing.md");

    expect(rules).toHaveLength(2);
  });

  it("agentId is lowercased: 'Togusa' in Agent column → agentId is 'togusa'", async () => {
    mockContent(`
# Routing Rules

## Rules

| Pattern | Agent | Priority |
|---------|-------|----------|
| test.*|Togusa|100|
`.trim());

    const rules = await loadRoutingRules("/project/.squad/routing.md");
    expect(rules).toHaveLength(1);
    expect(rules[0]?.agentId).toBe("togusa");
  });

  it("priority parsed as integer: '100' in Priority column → priority is 100", async () => {
    mockContent(WELL_FORMED_ROUTING_MD);
    const rules = await loadRoutingRules("/project/.squad/routing.md");

    const togusaRule = rules.find((r) => r.agentId === "togusa") as RoutingRule;
    expect(togusaRule.priority).toBe(100);
    expect(typeof togusaRule.priority).toBe("number");
  });

  it("rules sorted by priority descending: priority 100 > 50 > 10", async () => {
    mockContent(`
# Routing Rules

## Rules

| Pattern | Agent | Priority |
|---------|-------|----------|
| *.ts|batou|50|
| test.*|togusa|100|
| docs.*|motoko|10|
`.trim());

    const rules = await loadRoutingRules("/project/.squad/routing.md");

    expect(rules).toHaveLength(3);
    expect(rules[0]?.priority).toBe(100);
    expect(rules[1]?.priority).toBe(50);
    expect(rules[2]?.priority).toBe(10);
  });

  it("file not found: path doesn't exist → returns [] without throwing", async () => {
    mockEnoent();
    const rules = await loadRoutingRules("/does/not/exist/routing.md");
    expect(rules).toEqual([]);
  });

  it("empty file: file exists but is empty → returns []", async () => {
    mockContent("");
    const rules = await loadRoutingRules("/project/.squad/routing.md");
    expect(rules).toEqual([]);
  });

  it("malformed row skipped: row with missing columns is skipped, others returned", async () => {
    mockContent(`
# Routing Rules

## Rules

| Pattern | Agent | Priority |
|---------|-------|----------|
| test.*|togusa|100|
| bad-row |
| *.ts|batou|50|
`.trim());

    const rules = await loadRoutingRules("/project/.squad/routing.md");
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.agentId)).toContain("togusa");
    expect(rules.map((r) => r.agentId)).toContain("batou");
  });

  it("string pattern: bare 'test.*' stored as string, not auto-converted to RegExp", async () => {
    mockContent(WELL_FORMED_ROUTING_MD);
    const rules = await loadRoutingRules("/project/.squad/routing.md");

    const togusaRule = rules.find((r) => r.agentId === "togusa") as RoutingRule;
    expect(typeof togusaRule.pattern).toBe("string");
    expect(togusaRule.pattern).toBe("test.*");
  });

  it("regexp pattern: '/^test/i' stored as RegExp with correct source and flags", async () => {
    mockContent(`
# Routing Rules

## Rules

| Pattern | Agent | Priority |
|---------|-------|----------|
| /^test/i|togusa|100|
`.trim());

    const rules = await loadRoutingRules("/project/.squad/routing.md");
    expect(rules).toHaveLength(1);

    const rule = rules[0] as RoutingRule;
    expect(rule.pattern).toBeInstanceOf(RegExp);
    expect((rule.pattern as RegExp).source).toBe("^test");
    expect((rule.pattern as RegExp).flags).toContain("i");
  });
});
