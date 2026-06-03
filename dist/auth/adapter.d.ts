/**
 * @module auth/adapter
 *
 * Unified auth interface and factory for the pi-squad auth adapter layer.
 * Squad agents use abstract model tiers ("fast", "balanced", "capable"); this module
 * maps those tiers to concrete model IDs based on the active Pi provider.
 *
 * Design reference: docs/ARCHITECTURE.md §5.1, §5.2, §5.3
 */
import { ModelRegistry } from "@earendil-works/pi-coding-agent";
/** Concrete model type derived from ModelRegistry to avoid direct pi-ai dependency */
type AnyModel = ReturnType<ModelRegistry["getAll"]>[number];
export type { ModelRegistry };
/** Unified auth interface for Squad's tier-based model selection (§5.1) */
export interface AuthAdapter {
    /** Currently active provider name */
    provider: "copilot" | "codex" | "anthropic" | "ollama" | string;
    /** Get a model suitable for the given task tier */
    getModel(tier: "fast" | "balanced" | "capable"): Promise<AnyModel>;
    /** Check if the current auth is valid and ready */
    isReady(): Promise<boolean>;
}
/**
 * Detect the active provider from ModelRegistry (§5.3).
 * Uses pattern matching on the default available model's ID and provider field.
 * Falls back to "unknown" if no model is available.
 */
export declare function detectProvider(modelRegistry: ModelRegistry): Promise<string>;
/**
 * Create an AuthAdapter for the given provider.
 * Callers should use detectProvider() first, then pass the result here.
 */
export declare function createAuthAdapter(provider: string, modelRegistry: ModelRegistry): AuthAdapter;
//# sourceMappingURL=adapter.d.ts.map