/**
 * @module context/monitor
 * Context window monitoring for the Squad coordinator.
 *
 * The ContextMonitor hooks into Pi's `before_agent_start` event to measure
 * context utilization at each turn. It emits typed pressure events and triggers
 * recovery when thresholds are crossed.
 *
 * Design principles:
 * - Non-blocking by default: monitoring is passive observation until thresholds hit
 * - Pi-agnostic measurement: works with native token counts OR character approximation
 * - Event-driven: consumers subscribe to typed pressure events
 * - Deterministic: same state always produces same pressure classification
 */
import { ContextPressureLevel } from "./types.js";
import type { ContextBudget, ContextMonitorConfig, TokenEstimator, AnyContextEvent } from "./types.js";
/**
 * Callback signature for context event listeners.
 */
export type ContextEventListener = (event: AnyContextEvent) => void;
/**
 * Character-based token approximation.
 * Uses the standard heuristic of ~4 characters per token.
 * This is the fallback when Pi does not expose native token counts.
 */
export interface CharApproxEstimator extends TokenEstimator {
    readonly method: "char-approx";
    /** Characters-per-token ratio used (default: 4) */
    readonly charsPerToken: number;
}
/**
 * Native Pi token counter (when available).
 * Wraps Pi's tokenization API for exact counts.
 */
export interface PiNativeEstimator extends TokenEstimator {
    readonly method: "pi-native";
    /** The model ID used for tokenization (tokenizers are model-specific) */
    readonly modelId: string;
}
/**
 * Factory function signature for creating the appropriate token estimator.
 * Probes Pi's capabilities at startup and returns the best available estimator.
 *
 * @param pi - Pi ExtensionAPI instance (used to probe for native tokenizer)
 * @returns The most accurate available token estimator
 */
export type CreateTokenEstimator = (pi: unknown) => TokenEstimator;
/**
 * The ContextMonitor observes context window utilization across coordinator turns.
 *
 * Lifecycle:
 * 1. Created at coordinator init with a `ContextMonitorConfig`
 * 2. `measure()` is called at each `before_agent_start` event
 * 3. When a threshold is crossed, the monitor emits a `ContextPressureEvent`
 * 4. At CRITICAL/OVERFLOW, the monitor signals the `RecoveryOrchestrator`
 *
 * The monitor does NOT perform recovery itself — it only detects pressure
 * and signals the orchestrator. This separation keeps measurement pure.
 */
export interface ContextMonitor {
    /**
     * Measure the current context utilization and return a budget snapshot.
     * This is the primary measurement entrypoint, called at each coordinator turn.
     *
     * @param content - The full content that would be injected into context
     *   (system prompt + coordinator prompt + history + active work)
     * @returns Budget snapshot with current pressure classification
     */
    measure(content: string): ContextBudget;
    /**
     * Classify a utilization percentage into a pressure level.
     * Uses the configured thresholds from `ContextMonitorConfig`.
     *
     * @param utilizationPercent - Current utilization (0–100+)
     * @returns The corresponding pressure level
     */
    classify(utilizationPercent: number): ContextPressureLevel;
    /**
     * Get the most recent budget measurement.
     * Returns null if no measurement has been taken yet.
     */
    getLastBudget(): ContextBudget | null;
    /**
     * Get the current configuration (immutable snapshot).
     */
    getConfig(): Readonly<ContextMonitorConfig>;
    /**
     * Update the monitor configuration.
     * Validates the new config before applying.
     * @throws {ContextConfigError} if the configuration is invalid
     */
    updateConfig(config: Partial<ContextMonitorConfig>): void;
    /**
     * Subscribe to context events (pressure changes, overflow, recovery).
     * @param listener - Callback invoked when a context event occurs
     * @returns Unsubscribe function
     */
    on(listener: ContextEventListener): () => void;
    /**
     * Get the history of budget measurements for this session.
     * Useful for trend analysis and debugging.
     *
     * @param limit - Maximum number of entries to return (most recent first)
     * @returns Array of budget snapshots, newest first
     */
    getHistory(limit?: number): readonly ContextBudget[];
    /**
     * Reset the monitor state (e.g., after a full context flush).
     * Clears measurement history and resets turn counter.
     * Does NOT change configuration.
     */
    reset(): void;
    /**
     * The token estimator in use by this monitor.
     * Exposed for strategies that need to estimate sizes independently.
     */
    readonly estimator: TokenEstimator;
}
/**
 * Factory function signature for creating a ContextMonitor.
 *
 * @param config - Monitor configuration (thresholds, strategies, etc.)
 * @param estimator - Token estimator to use for measurements
 * @returns A configured ContextMonitor instance
 */
export type CreateContextMonitor = (config: ContextMonitorConfig, estimator: TokenEstimator) => ContextMonitor;
/**
 * Factory function signature for creating the default monitor configuration.
 * Provides sensible defaults for a typical Squad coordinator session.
 *
 * @param contextWindowSize - Total context window tokens (e.g., 200000 for Claude)
 * @returns A complete ContextMonitorConfig with default thresholds
 */
export type CreateDefaultConfig = (contextWindowSize: number) => ContextMonitorConfig;
/**
 * Hook signature for integrating the monitor into Pi's event system.
 * This is the glue between Pi's `before_agent_start` event and the monitor.
 *
 * When registered, this hook:
 * 1. Measures the context that would be injected
 * 2. Emits pressure events if thresholds are crossed
 * 3. Returns a signal indicating whether recovery is needed
 *
 * @param monitor - The active ContextMonitor instance
 * @param content - Content being prepared for injection
 * @param turnIndex - Current turn number in the session
 * @returns Assessment result with pressure level and whether recovery is needed
 */
export interface ContextAssessment {
    /** The measured budget */
    readonly budget: ContextBudget;
    /** Whether the coordinator should trigger recovery before proceeding */
    readonly recoveryNeeded: boolean;
    /** If recovery is needed, which pressure level triggered it */
    readonly triggerLevel: ContextPressureLevel | null;
}
/**
 * Function signature for the before_agent_start integration hook.
 */
export type AssessContext = (monitor: ContextMonitor, content: string, turnIndex: number) => ContextAssessment;
export declare class CharApproxTokenEstimator implements TokenEstimator {
    readonly method: "char-approx";
    readonly charsPerToken: number;
    constructor(charsPerToken?: number);
    estimate(text: string): number;
}
export declare class SimpleContextMonitor {
    private readonly budget;
    private readonly handlers;
    private lastAssessment;
    readonly estimator: TokenEstimator;
    constructor(budget: ContextBudget, estimator?: TokenEstimator);
    /** Measure token count of text (char-approx: text.length / 4) */
    measure(text: string): number;
    /** Classify pressure level based on % of budget used */
    classify(used: number): ContextPressureLevel;
    /** Register handler for a pressure level */
    on(level: ContextPressureLevel, handler: (assessment: ContextAssessment) => void): void;
    /** Assess current context, emit events if threshold crossed */
    assess(content: string, history?: string[]): ContextAssessment;
}
//# sourceMappingURL=monitor.d.ts.map