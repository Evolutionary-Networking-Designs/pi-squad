/**
 * @module context/recovery
 * Recovery strategies and orchestration for context overflow situations.
 *
 * Design principles:
 * - Every strategy is idempotent: running twice produces the same result
 * - `.squad/` state is never destructively modified — only additive writes
 * - The orchestrator sequences strategies based on pressure level
 * - If ALL strategies fail at OVERFLOW, a typed ContextOverflowError is thrown
 * - Recovery is explicit, typed, and auditable — never silent
 */
import { ContextPressureLevel } from "./types.js";
import type { ContextMonitorConfig, RecoveryContext, RecoveryResult, RecoveryAttempt } from "./types.js";
import type { SessionStore } from "./store.js";
/**
 * A recovery strategy that can reduce context window pressure.
 *
 * Strategies are:
 * - Idempotent: calling execute() twice with the same context is safe
 * - Non-destructive to `.squad/`: may add files (checkpoints) but never delete/modify existing state
 * - Self-describing: provide metadata for orchestration and audit logging
 */
export interface RecoveryStrategy {
    /**
     * Unique identifier for this strategy.
     * Used in config, audit logs, and orchestration.
     */
    readonly id: string;
    /**
     * Human-readable name for logging and user-facing messages.
     */
    readonly displayName: string;
    /**
     * Description of what this strategy does when executed.
     */
    readonly description: string;
    /**
     * Minimum pressure level at which this strategy should be considered.
     * The orchestrator will not invoke a strategy below its minimum level.
     */
    readonly minimumLevel: ContextPressureLevel;
    /**
     * Estimated tokens this strategy can typically free.
     * Used by the orchestrator to select the least-disruptive strategy first.
     * Returns 0 if estimation is not possible (strategy will be tried regardless).
     *
     * @param ctx - The current recovery context
     * @returns Estimated tokens that could be freed
     */
    estimateFreeable(ctx: RecoveryContext): number;
    /**
     * Execute the recovery strategy.
     *
     * Implementations must:
     * - Be idempotent (safe to call multiple times)
     * - Not destructively modify `.squad/` files
     * - Return a complete RecoveryResult regardless of success/failure
     * - Not throw — failures are reported via RecoveryResult.success = false
     *
     * @param ctx - Full recovery context (budget, state, history, estimator)
     * @returns Result describing what was done and how much was freed
     */
    execute(ctx: RecoveryContext): Promise<RecoveryResult>;
    /**
     * Whether this strategy can meaningfully act given the current context.
     * The orchestrator checks this before calling execute() to avoid no-ops.
     *
     * @param ctx - The current recovery context
     * @returns true if the strategy has something to recover
     */
    canAct(ctx: RecoveryContext): boolean;
}
/**
 * Compresses `.squad/agents/* /history.md` entries into concise summaries.
 * Reduces context by replacing verbose history with compressed digests.
 *
 * Behavior:
 * - Reads agent history files from `.squad/agents/`
 * - Produces `HistorySummary` records for entries older than a threshold
 * - The coordinator re-injects summaries instead of raw history on next turn
 * - Original history.md files are NEVER modified (summaries are in-memory only)
 *
 * Minimum level: WARNING
 */
export interface SummarizeStrategy extends RecoveryStrategy {
    readonly id: "summarize";
    /**
     * Configuration for summarization behavior.
     */
    readonly config: SummarizeStrategyConfig;
}
/**
 * Configuration for the SummarizeStrategy.
 */
export interface SummarizeStrategyConfig {
    /**
     * Entries older than this many turns are eligible for summarization.
     * Default: 5 turns.
     */
    readonly ageThresholdTurns: number;
    /**
     * Target compression ratio (e.g., 0.3 = compress to 30% of original size).
     * Default: 0.25 (4:1 compression).
     */
    readonly targetCompressionRatio: number;
    /**
     * Maximum number of history entries to keep unsummarized (most recent).
     * Default: 3.
     */
    readonly keepRecentCount: number;
    /**
     * Agents whose history should never be summarized (e.g., active agent).
     */
    readonly excludeAgents: readonly string[];
}
/**
 * Saves full coordinator state to `.squad/checkpoints/{timestamp}.json`,
 * allowing the coordinator to restart with a fresh context window.
 *
 * Behavior:
 * - Serializes `CoordinatorStateSnapshot` to a checkpoint file
 * - Checkpoint file is additive (never overwrites existing checkpoints)
 * - After checkpoint, signals that a full context re-inject is required
 * - The coordinator rebuilds its working set from `.squad/` files + checkpoint metadata
 *
 * Minimum level: CRITICAL
 */
export interface CheckpointStrategy extends RecoveryStrategy {
    readonly id: "checkpoint";
    /**
     * Configuration for checkpoint behavior.
     */
    readonly config: CheckpointStrategyConfig;
}
/**
 * Configuration for the CheckpointStrategy.
 */
export interface CheckpointStrategyConfig {
    /**
     * Directory where checkpoint files are written.
     * Relative to the `.squad/` root.
     * Default: "checkpoints"
     */
    readonly checkpointDir: string;
    /**
     * Maximum number of checkpoint files to retain.
     * Oldest checkpoints are pruned when this limit is exceeded.
     * Default: 10.
     */
    readonly maxCheckpoints: number;
    /**
     * Whether to include full routing table in checkpoint (can be large).
     * Default: false (only include routing digest).
     */
    readonly includeFullRouting: boolean;
}
/**
 * Drops oldest history entries and non-critical decisions while
 * preserving the active work context.
 *
 * Behavior:
 * - Identifies the least-critical content in the coordinator's working set
 * - Drops: old history entries, resolved decisions, inactive agent state
 * - Keeps: active work items, recent decisions, current agent context
 * - Does NOT modify `.squad/` files — only the in-memory coordinator state
 *
 * Minimum level: WARNING
 */
export interface GracefulDegradeStrategy extends RecoveryStrategy {
    readonly id: "graceful-degrade";
    /**
     * Configuration for degradation behavior.
     */
    readonly config: GracefulDegradeStrategyConfig;
}
/**
 * Configuration for the GracefulDegradeStrategy.
 */
export interface GracefulDegradeStrategyConfig {
    /**
     * Priority order for content to drop (first = dropped first).
     * Default: ["resolved-decisions", "old-history", "inactive-agents", "skill-context"]
     */
    readonly dropOrder: readonly string[];
    /**
     * Minimum content to always retain regardless of pressure.
     * These content types are never dropped.
     * Default: ["active-work", "team-roster", "routing-rules"]
     */
    readonly alwaysRetain: readonly string[];
    /**
     * Target utilization percentage after degradation.
     * Stops dropping content once this target is reached.
     * Default: 60 (drop until 60% utilization).
     */
    readonly targetUtilization: number;
}
/**
 * Surfaces a typed error to Pi/user, pausing the agent loop until acknowledged.
 * This is the "last resort" strategy when automated recovery has failed.
 *
 * Behavior:
 * - Does NOT attempt to free tokens automatically
 * - Throws a `ContextOverflowError` with full diagnostic information
 * - The error includes: budget snapshot, all recovery attempts, and suggested actions
 * - Pi surfaces this to the user; the agent loop pauses until acknowledged
 *
 * Minimum level: OVERFLOW
 */
export interface EscalateStrategy extends RecoveryStrategy {
    readonly id: "escalate";
}
/**
 * Selects and sequences recovery strategies based on the current pressure level.
 *
 * The orchestrator:
 * 1. Receives a pressure signal from the ContextMonitor
 * 2. Selects strategies appropriate for the pressure level (from config)
 * 3. Executes them in order until pressure is resolved or all fail
 * 4. If at OVERFLOW and all strategies fail, throws ContextOverflowError
 *
 * Strategy selection logic:
 * - Only strategies whose `minimumLevel` ≤ current level are considered
 * - Strategies are tried in the order specified in `ContextMonitorConfig.recoveryStrategies`
 * - A strategy is skipped if `canAct()` returns false
 * - After each strategy, pressure is re-measured; if resolved, orchestration stops
 */
export interface RecoveryOrchestrator {
    /**
     * Execute recovery for the given pressure level.
     * Tries strategies in order until pressure is resolved or escalation occurs.
     *
     * @param level - The pressure level that triggered recovery
     * @param ctx - Recovery context with current state and budget
     * @returns The final RecoveryResult (from the strategy that resolved pressure)
     * @throws {ContextOverflowError} if at OVERFLOW and all strategies fail
     */
    recover(level: ContextPressureLevel, ctx: RecoveryContext): Promise<RecoveryResult>;
    /**
     * Register a recovery strategy with the orchestrator.
     * Strategies must have unique IDs; duplicate registration throws.
     *
     * @param strategy - The strategy to register
     * @throws {Error} if a strategy with the same ID is already registered
     */
    register(strategy: RecoveryStrategy): void;
    /**
     * Get all registered strategy IDs in priority order for a given level.
     *
     * @param level - The pressure level to get strategies for
     * @returns Ordered list of strategy IDs that would be tried
     */
    getStrategiesForLevel(level: ContextPressureLevel): readonly string[];
    /**
     * Get the full audit trail of recovery attempts in this session.
     * Ordered chronologically (oldest first).
     */
    getAttemptHistory(): readonly RecoveryAttempt[];
    /**
     * Reset the orchestrator state (clears attempt history).
     * Called after a full context flush to start fresh.
     */
    reset(): void;
}
/**
 * Factory for creating the RecoveryOrchestrator with default strategies registered.
 *
 * @param config - Monitor configuration (determines strategy ordering per level)
 * @param teamRoot - Absolute path to `.squad/` directory
 * @returns Configured RecoveryOrchestrator with all built-in strategies registered
 */
export type CreateRecoveryOrchestrator = (config: ContextMonitorConfig, teamRoot: string) => RecoveryOrchestrator;
/**
 * Factory for creating individual strategy instances.
 */
export type CreateSummarizeStrategy = (config?: Partial<SummarizeStrategyConfig>) => SummarizeStrategy;
export type CreateCheckpointStrategy = (config?: Partial<CheckpointStrategyConfig>) => CheckpointStrategy;
export type CreateGracefulDegradeStrategy = (config?: Partial<GracefulDegradeStrategyConfig>) => GracefulDegradeStrategy;
export type CreateEscalateStrategy = () => EscalateStrategy;
export interface RecoveryStores {
    readonly root: SessionStore;
    readonly local?: SessionStore;
}
export declare class DefaultGracefulDegradeStrategy {
    readonly id: "graceful-degrade";
    readonly displayName = "Graceful Degrade";
    readonly description = "Drops low-priority prompt sections until pressure subsides.";
    readonly minimumLevel = ContextPressureLevel.WARNING;
    readonly config: GracefulDegradeStrategyConfig;
    constructor(config?: Partial<GracefulDegradeStrategyConfig>);
    estimateFreeable(ctx: RecoveryContext): number;
    canAct(ctx: RecoveryContext): boolean;
    execute(ctx: RecoveryContext): Promise<RecoveryResult>;
}
export declare class DefaultSummarizeStrategy {
    readonly id: "summarize";
    readonly displayName = "Summarize History";
    readonly description = "Compresses older history to keep only recent turns in active context.";
    readonly minimumLevel = ContextPressureLevel.WARNING;
    readonly config: SummarizeStrategyConfig;
    constructor(config?: Partial<SummarizeStrategyConfig>);
    estimateFreeable(ctx: RecoveryContext): number;
    canAct(ctx: RecoveryContext): boolean;
    execute(ctx: RecoveryContext): Promise<RecoveryResult>;
    private getSummarizableEntries;
}
export declare class DefaultCheckpointStrategy {
    readonly id: "checkpoint";
    readonly displayName = "Checkpoint State";
    readonly description = "Persists coordinator state to a checkpoint file for later recovery.";
    readonly minimumLevel = ContextPressureLevel.CRITICAL;
    readonly config: CheckpointStrategyConfig;
    constructor(config?: Partial<CheckpointStrategyConfig>);
    estimateFreeable(ctx: RecoveryContext): number;
    canAct(_ctx: RecoveryContext): boolean;
    execute(ctx: RecoveryContext): Promise<RecoveryResult>;
}
export declare class DefaultEscalateStrategy {
    readonly id: "escalate";
    readonly displayName = "Escalate Overflow";
    readonly description = "Throws a typed overflow error when automated recovery is exhausted.";
    readonly minimumLevel = ContextPressureLevel.OVERFLOW;
    estimateFreeable(_ctx: RecoveryContext): number;
    canAct(_ctx: RecoveryContext): boolean;
    execute(ctx: RecoveryContext): Promise<RecoveryResult>;
}
export declare class DefaultRecoveryOrchestrator {
    private readonly stores;
    private readonly strategies;
    private readonly attemptHistory;
    constructor(stores: RecoveryStores, strategies?: RecoveryStrategy[]);
    register(strategy: RecoveryStrategy): void;
    getStrategiesForLevel(level: ContextPressureLevel): readonly string[];
    getAttemptHistory(): readonly RecoveryAttempt[];
    reset(): void;
    recover(levelOrCtx: ContextPressureLevel | RecoveryContext, maybeCtx?: RecoveryContext): Promise<RecoveryResult>;
    private recordAttempt;
}
//# sourceMappingURL=recovery.d.ts.map