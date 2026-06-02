import { describe, expect, it } from 'vitest';

import type { ModelRegistry } from '../../src/auth/adapter.js';
import { createAuthAdapter } from '../../src/auth/adapter.js';

type Model = ReturnType<ModelRegistry['getAll']>[number];

function makeModel(id: string, provider: string): Model {
  return { id, name: id, provider } as Model;
}

function makeRegistry(models: Model[]): ModelRegistry {
  return {
    getAvailable: () => models,
    getAll: () => models,
    find: (provider: string, id: string) =>
      models.find((model) => model.provider === provider && model.id === id),
  } as unknown as ModelRegistry;
}

describe('createAuthAdapter', () => {
  it('maps copilot tiers to the expected model ids', async () => {
    const registry = makeRegistry([
      makeModel('claude-haiku-4.5', 'copilot'),
      makeModel('claude-sonnet-4.6', 'copilot'),
      makeModel('claude-opus-4.5', 'copilot'),
    ]);
    const adapter = createAuthAdapter('copilot', registry);

    await expect(adapter.getModel('fast')).resolves.toMatchObject({ id: 'claude-haiku-4.5' });
    await expect(adapter.getModel('balanced')).resolves.toMatchObject({ id: 'claude-sonnet-4.6' });
    await expect(adapter.getModel('capable')).resolves.toMatchObject({ id: 'claude-opus-4.5' });
  });

  it('maps codex tiers to the expected model ids', async () => {
    const registry = makeRegistry([
      makeModel('gpt-5-mini', 'codex'),
      makeModel('gpt-5.2-codex', 'codex'),
      makeModel('gpt-5.3-codex', 'codex'),
    ]);
    const adapter = createAuthAdapter('codex', registry);

    await expect(adapter.getModel('fast')).resolves.toMatchObject({ id: 'gpt-5-mini' });
    await expect(adapter.getModel('balanced')).resolves.toMatchObject({ id: 'gpt-5.2-codex' });
    await expect(adapter.getModel('capable')).resolves.toMatchObject({ id: 'gpt-5.3-codex' });
  });

  it('maps anthropic and ollama providers to valid concrete models', async () => {
    const registry = makeRegistry([
      makeModel('claude-haiku-4.5', 'anthropic'),
      makeModel('claude-sonnet-4.6', 'anthropic'),
      makeModel('claude-opus-4.5', 'anthropic'),
      makeModel('llama3.2:3b', 'ollama'),
      makeModel('llama3.2:70b', 'ollama'),
    ]);

    for (const provider of ['anthropic', 'ollama'] as const) {
      const adapter = createAuthAdapter(provider, registry);
      const model = await adapter.getModel('balanced');

      expect(typeof model.id).toBe('string');
      expect(model.id.length).toBeGreaterThan(0);
    }
  });

  it('falls back gracefully for an unknown tier without crashing', async () => {
    const registry = makeRegistry([
      makeModel('claude-sonnet-4.6', 'copilot'),
      makeModel('claude-haiku-4.5', 'copilot'),
    ]);
    const adapter = createAuthAdapter('copilot', registry);

    const model = await adapter.getModel('unknown-tier' as never);

    expect(model.id).toBe('claude-sonnet-4.6');
  });

  it('falls back gracefully for an unknown provider without crashing', async () => {
    const registry = makeRegistry([
      makeModel('claude-haiku-4.5', 'copilot'),
      makeModel('claude-sonnet-4.6', 'copilot'),
      makeModel('claude-opus-4.5', 'copilot'),
    ]);
    const adapter = createAuthAdapter('mystery-provider', registry);

    const model = await adapter.getModel('fast');

    expect(model.id).toBe('claude-haiku-4.5');
  });
});
