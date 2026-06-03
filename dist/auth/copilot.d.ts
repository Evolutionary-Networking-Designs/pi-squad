/**
 * @module auth/copilot
 *
 * GitHub Copilot-specific auth provider.
 * Uses the "copilot" / "github-copilot" tier row from MODEL_TIERS.
 *
 * Design reference: docs/ARCHITECTURE.md §5.2
 */
import { type AuthAdapter, type ModelRegistry } from "./adapter.js";
/**
 * Create an AuthAdapter backed by the GitHub Copilot (Anthropic) model tier.
 * isReady() verifies that the default available model is a Claude model.
 */
export declare function createCopilotAdapter(modelRegistry: ModelRegistry): AuthAdapter;
//# sourceMappingURL=copilot.d.ts.map