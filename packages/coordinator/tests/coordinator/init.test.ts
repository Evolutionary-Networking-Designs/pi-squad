import { describe, expect, it, test } from 'vitest';

import initExtension from '../../src/index.js';
import { initializeCoordinator } from '../../src/coordinator/coordinator.js';

type Handler = (...args: unknown[]) => unknown;

function createPiStub() {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, { description: string; handler: Handler }>();
  const entries: Array<{ key: string; value: unknown }> = [];

  return {
    handlers,
    commands,
    entries,
    api: {
      on(event: string, handler: Handler) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      registerCommand(name: string, command: { description: string; handler: Handler }) {
        commands.set(name, command);
      },
      appendEntry(key: string, value: unknown) {
        entries.push({ key, value });
      },
    },
  };
}

describe('coordinator initialization', () => {
  it('can initialize the coordinator without throwing', async () => {
    const pi = createPiStub();

    await expect(initializeCoordinator(pi.api as never)).resolves.toMatchObject({
      getSystemPrompt: expect.any(Function),
      getTeamRoot: expect.any(Function),
      route: expect.any(Function),
    });
    expect(pi.handlers.get('session_start')).toHaveLength(1);
    expect(pi.handlers.get('turn_end')).toHaveLength(1);
    expect(pi.handlers.get('session_before_compact')).toHaveLength(1);
  });

  it('registers coordinator and Ralph hooks plus squad commands through the extension entry point', async () => {
    const pi = createPiStub();

    await initExtension(pi.api as never);

    expect(pi.handlers.get('before_agent_start')).toHaveLength(2);
    expect(pi.handlers.get('session_start')).toHaveLength(2);
    expect(pi.handlers.get('agent_end')).toHaveLength(2);
    expect(pi.handlers.get('turn_end')).toHaveLength(2);
    expect(pi.handlers.get('session_before_compact')).toHaveLength(2);
    expect(pi.handlers.get('session_shutdown')).toHaveLength(2);
    expect(pi.commands.has('squad')).toBe(true);
    expect(pi.commands.has('squad-init')).toBe(true);
    expect(pi.commands.has('squad-update')).toBe(true);
  });

  it('injects the coordinator prompt ahead of the existing system prompt', async () => {
    const pi = createPiStub();

    await initExtension(pi.api as never);

    const handlers = pi.handlers.get('before_agent_start') ?? [];
    let result: unknown;
    for (const handler of handlers) {
      const nextResult = await handler({ systemPrompt: 'Base system prompt' }, {});
      if (nextResult !== undefined) {
        result = nextResult;
      }
    }

    expect(result).toMatchObject({
      systemPrompt: expect.stringContaining('Base system prompt'),
    });
    expect((result as { systemPrompt: string }).systemPrompt).toContain('Squad Coordinator');
  });

  it('wires the visibility boundary and coordinator guardrails into runtime enforcement', async () => {
    const pi = createPiStub();
    const coordinator = await initializeCoordinator(pi.api as never);

    await expect(coordinator.route('{"type":"agent_spawn"}', { sessionId: 'guard-test' })).resolves
      .toBeUndefined();
    expect(pi.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'pi-squad.route.lifecycle',
          value: expect.objectContaining({
            stage: 'guard_violation',
            violationCode: 'MISSING_REQUIRED_FIELD',
            sessionId: 'guard-test',
          }),
        }),
      ]),
    );
  });
});
