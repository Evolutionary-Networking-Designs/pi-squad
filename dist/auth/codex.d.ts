/**
 * @module auth/codex
 *
 * OpenAI Codex-specific auth provider.
 * Uses the "codex" / "openai-codex" tier row from MODEL_TIERS.
 *
 * Design reference: docs/ARCHITECTURE.md §5.2
 */
import { type AuthAdapter, type ModelRegistry } from "./adapter.js";
/**
 * Create an AuthAdapter backed by the OpenAI Codex model tier.
 * isReady() verifies that the default available model is a GPT model.
 */
export declare function createCodexAdapter(modelRegistry: ModelRegistry): AuthAdapter;
//# sourceMappingURL=codex.d.ts.map