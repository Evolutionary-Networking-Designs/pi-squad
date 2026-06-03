/**
 * @module auth/copilot
 *
 * GitHub Copilot-specific auth provider.
 * Uses the "copilot" / "github-copilot" tier row from MODEL_TIERS.
 *
 * Design reference: docs/ARCHITECTURE.md §5.2
 */
import { createAuthAdapter } from "./adapter.js";
/**
 * Create an AuthAdapter backed by the GitHub Copilot (Anthropic) model tier.
 * isReady() verifies that the default available model is a Claude model.
 */
export function createCopilotAdapter(modelRegistry) {
    const base = createAuthAdapter("copilot", modelRegistry);
    return {
        provider: "copilot",
        getModel: (tier) => base.getModel(tier),
        async isReady() {
            const available = modelRegistry.getAvailable();
            if (available.length === 0)
                return false;
            // Copilot uses Anthropic Claude models
            return available[0].id.startsWith("claude-");
        },
    };
}
//# sourceMappingURL=copilot.js.map