import { describe, expect, it } from 'vitest';

import {
  routeLocal,
  routeWithEscalation,
  type DispatchTable,
  type RoutingRule,
  type TeamMember,
} from './router.js';

function buildMember(id: string): TeamMember {
  return {
    id,
    name: id,
    role: 'tester',
    emoji: '🧪',
    skills: [],
  };
}

function buildTable(
  members: TeamMember[],
  rules: RoutingRule[],
  parent?: DispatchTable,
): DispatchTable {
  return {
    members: new Map(members.map((member) => [member.id, member])),
    rules,
    parsedAt: new Date(0).toISOString(),
    sourceHash: 'test',
    parent,
  };
}

describe('routeLocal', () => {
  it('returns matching agent from dispatch table', () => {
    const analyst = buildMember('analyst');
    const table = buildTable([analyst], [{ pattern: 'security', agentId: 'analyst', priority: 10 }]);

    const result = routeLocal(table, 'Need security review');
    expect(result?.agent.id).toBe('analyst');
    expect(result?.matchedRule?.agentId).toBe('analyst');
  });

  it('returns null when there is no matching rule', () => {
    const analyst = buildMember('analyst');
    const table = buildTable([analyst], [{ pattern: 'security', agentId: 'analyst', priority: 10 }]);

    expect(routeLocal(table, 'Refactor routing logic')).toBeNull();
  });
});

describe('routeWithEscalation', () => {
  it('escalates to parent table when local has no match', () => {
    const parentAgent = buildMember('parent-agent');
    const parent = buildTable(
      [parentAgent],
      [{ pattern: 'release', agentId: 'parent-agent', priority: 10 }],
    );
    const local = buildTable([], [], parent);

    const result = routeWithEscalation(local, 'Prepare release checklist');
    expect(result?.agent.id).toBe('parent-agent');
    expect(result?.escalatedTo).toBe('root');
  });

  it('returns null when neither local nor parent matches', () => {
    const parentAgent = buildMember('parent-agent');
    const parent = buildTable(
      [parentAgent],
      [{ pattern: 'release', agentId: 'parent-agent', priority: 10 }],
    );
    const local = buildTable([], [], parent);

    expect(routeWithEscalation(local, 'Update docs')).toBeNull();
  });
});
