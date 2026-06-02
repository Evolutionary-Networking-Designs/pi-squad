/**
 * @module auth/codex
 *
 * OpenAI Codex-specific auth provider.
 * Uses the "codex" / "openai-codex" tier row from MODEL_TIERS.
 *
 * Design reference: docs/ARCHITECTURE.md §5.2
 */

import { type AuthAdapter, createAuthAdapter, type ModelRegistry } from "./adapter.js";

/**
 * Create an AuthAdapter backed by the OpenAI Codex model tier.
 * isReady() verifies that the default available model is a GPT model.
 */
export function createCodexAdapter(modelRegistry: ModelRegistry): AuthAdapter {
  const base = createAuthAdapter("codex", modelRegistry);

  return {
    provider: "codex",

    getModel: (tier) => base.getModel(tier),

    async isReady(): Promise<boolean> {
      const available = modelRegistry.getAvailable();
      if (available.length === 0) return false;
      // Codex uses OpenAI GPT models
      return available[0].id.startsWith("gpt-");
    },
  };
}
