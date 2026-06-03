/**
 * @module auth/adapter
 *
 * Unified auth interface and factory for the pi-squad auth adapter layer.
 * Squad agents use abstract model tiers ("fast", "balanced", "capable"); this module
 * maps those tiers to concrete model IDs based on the active Pi provider.
 *
 * Design reference: docs/ARCHITECTURE.md §5.1, §5.2, §5.3
 */
// ─── Model Tier Mapping ───────────────────────────────────────────────────────
/** Maps provider name → tier name → concrete model ID (§5.2) */
const MODEL_TIERS = {
    copilot: {
        fast: "claude-haiku-4.5",
        balanced: "claude-sonnet-4.6",
        capable: "claude-opus-4.5",
    },
    "github-copilot": {
        fast: "claude-haiku-4.5",
        balanced: "claude-sonnet-4.6",
        capable: "claude-opus-4.5",
    },
    codex: {
        fast: "gpt-5-mini",
        balanced: "gpt-5.2-codex",
        capable: "gpt-5.3-codex",
    },
    "openai-codex": {
        fast: "gpt-5-mini",
        balanced: "gpt-5.2-codex",
        capable: "gpt-5.3-codex",
    },
    anthropic: {
        fast: "claude-haiku-4.5",
        balanced: "claude-sonnet-4.6",
        capable: "claude-opus-4.5",
    },
    ollama: {
        fast: "llama3.2:3b",
        balanced: "llama3.2:70b",
        capable: "llama3.2:70b",
    },
};
// ─── Provider Detection ───────────────────────────────────────────────────────
/**
 * Detect the active provider from ModelRegistry (§5.3).
 * Uses pattern matching on the default available model's ID and provider field.
 * Falls back to "unknown" if no model is available.
 */
export async function detectProvider(modelRegistry) {
    const available = modelRegistry.getAvailable();
    const defaultModel = available[0];
    if (!defaultModel)
        return "unknown";
    if (defaultModel.id.startsWith("claude-"))
        return "copilot";
    if (defaultModel.id.startsWith("gpt-"))
        return "codex";
    if (defaultModel.id.includes("ollama") || defaultModel.provider === "ollama")
        return "ollama";
    // Fall back to the provider string from the model
    return defaultModel.provider || "unknown";
}
// ─── Base Adapter Implementation ─────────────────────────────────────────────
class BaseAuthAdapter {
    provider;
    modelRegistry;
    constructor(provider, modelRegistry) {
        this.provider = provider;
        this.modelRegistry = modelRegistry;
    }
    /**
     * Resolve a concrete model for the given tier.
     * 1. Look up MODEL_TIERS[provider][tier]
     * 2. If found, call modelRegistry.find(provider, modelId)
     * 3. If provider unknown or model not found, fall back to copilot tier
     * 4. Never throws — always returns a model
     */
    async getModel(tier) {
        const providerTiers = MODEL_TIERS[this.provider] ?? MODEL_TIERS["copilot"];
        const modelId = providerTiers[tier] ?? MODEL_TIERS["copilot"][tier];
        // Try provider-specific lookup first
        const found = this.modelRegistry.find(this.provider, modelId);
        if (found)
            return found;
        // Try scanning all available models for the model ID
        const byId = this.modelRegistry.getAll().find((m) => m.id === modelId);
        if (byId)
            return byId;
        // Fallback: copilot balanced model via any provider
        const fallbackId = MODEL_TIERS["copilot"]["balanced"];
        const fallback = this.modelRegistry.getAll().find((m) => m.id === fallbackId);
        if (fallback)
            return fallback;
        // Last resort: return first available model (never throws)
        const all = this.modelRegistry.getAll();
        if (all.length > 0)
            return all[0];
        // Construct a minimal model stub so callers never receive undefined
        return {
            id: modelId,
            name: modelId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal stub when no real model available
            api: "anthropic-messages",
            provider: this.provider,
            baseUrl: "",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200000,
            maxTokens: 8192,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal stub
        };
    }
    async isReady() {
        return this.modelRegistry.getAvailable().length > 0;
    }
}
// ─── Factory ──────────────────────────────────────────────────────────────────
/**
 * Create an AuthAdapter for the given provider.
 * Callers should use detectProvider() first, then pass the result here.
 */
export function createAuthAdapter(provider, modelRegistry) {
    return new BaseAuthAdapter(provider, modelRegistry);
}
//# sourceMappingURL=adapter.js.map