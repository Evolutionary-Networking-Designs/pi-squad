/**
 * @module context/types
 * Shared types for the context monitoring and recovery subsystem.
 *
 * Design invariants:
 * - All token estimates are approximate (Pi may not expose raw counts)
 * - Pressure levels form an ordered enum: NOMINAL < WARNING < CRITICAL < OVERFLOW
 * - Recovery is idempotent — running a strategy twice must be safe
 * - `.squad/` state is never destructively modified; checkpoints are additive
 */
/**
 * Ordered pressure levels representing context window utilization.
 * Each level triggers progressively more aggressive recovery strategies.
 */
export declare enum ContextPressureLevel {
    /** Context usage is within normal operating bounds (< 70%) */
    NOMINAL = "NOMINAL",
    /** Context usage is elevated; begin passive preparation (70–89%) */
    WARNING = "WARNING",
    /** Context usage is dangerously high; active recovery required (90–99%) */
    CRITICAL = "CRITICAL",
    /** Context has exceeded capacity; immediate intervention required (≥ 100%) */
    OVERFLOW = "OVERFLOW"
}
/**
 * Snapshot of the context window budget at a point in time.
 * All values are in estimated tokens.
 */
export interface ContextBudget {
    /** Maximum tokens available in the context window */
    readonly total: number;
    /** Estimated tokens currently consumed */
    readonly used: number;
    /** Remaining tokens available (total - used) */
    readonly available: number;
    /** Current pressure classification */
    readonly pressureLevel: ContextPressureLevel;
    /** Percentage of context consumed (0–100+). May exceed 100 in overflow. */
    readonly utilizationPercent: number;
    /** ISO 8601 timestamp when this measurement was taken */
    readonly measuredAt: string;
}
/**
 * Strategy for estimating token count from content.
 * Pi may or may not expose raw token counts — this abstraction supports both.
 */
export interface TokenEstimator {
    /**
     * Estimate the token count for the given text content.
     * @param content - The text to estimate tokens for
     * @returns Estimated token count (always a positive integer)
     */
    estimate(content: string): number;
    /** Human-readable name of the estimation method (e.g., "pi-native", "char-approx") */
    readonly method: string;
}
/**
 * Configuration for the context monitoring subsystem.
 * Sensible defaults are provided by `createDefaultConfig()`.
 */
export interface ContextMonitorConfig {
    /** Total context window size in tokens. Must be > 0. */
    readonly contextWindowSize: number;
    /** Threshold percentages that trigger each pressure level (0–100) */
    readonly thresholds: Readonly<{
        /** Percentage at which WARNING is triggered (default: 70) */
        warning: number;
        /** Percentage at which CRITICAL is triggered (default: 90) */
        critical: number;
        /** Percentage at which OVERFLOW is triggered (default: 100) */
        overflow: number;
    }>;
    /**
     * Ordered list of recovery strategy identifiers to attempt at each pressure level.
     * Strategies are tried in order; first successful strategy wins.
     */
    readonly recoveryStrategies: Readonly<{
        /** Strategies to attempt when WARNING is reached */
        onWarning: readonly string[];
        /** Strategies to attempt when CRITICAL is reached */
        onCritical: readonly string[];
        /** Strategies to attempt when OVERFLOW is reached */
        onOverflow: readonly string[];
    }>;
    /** Whether context monitoring is enabled (allows disabling without removing config) */
    readonly enabled: boolean;
    /**
     * Minimum number of turns between recovery attempts to prevent thrashing.
     * Default: 1 (check every turn).
     */
    readonly minTurnsBetweenRecovery: number;
}
/**
 * Base interface for all context-related events.
 */
export interface ContextEvent {
    /** Event type discriminator */
    readonly type: string;
    /** Budget snapshot at the time of the event */
    readonly budget: ContextBudget;
    /** Monotonically increasing turn index within the session */
    readonly turnIndex: number;
}
/**
 * Emitted when context pressure crosses a threshold boundary.
 * Listeners can use this to trigger UI indicators or logging.
 */
export interface ContextPressureEvent extends ContextEvent {
    readonly type: "context:pressure";
    /** The pressure level that was just entered */
    readonly level: ContextPressureLevel;
    /** The previous pressure level (for transition detection) */
    readonly previousLevel: ContextPressureLevel;
}
/**
 * Emitted when context has exceeded capacity and recovery is being attempted.
 * This is an urgent event — if recovery fails, the coordinator will throw.
 */
export interface ContextOverflowEvent extends ContextEvent {
    readonly type: "context:overflow";
    /** How many tokens over budget the context is */
    readonly overflowTokens: number;
}
/**
 * Emitted after a recovery strategy completes (success or failure).
 */
export interface ContextRecoveryEvent extends ContextEvent {
    readonly type: "context:recovery";
    /** The strategy that was executed */
    readonly strategyId: string;
    /** The result of the recovery attempt */
    readonly result: RecoveryResult;
}
/** Union of all context events for type-safe event handling */
export type AnyContextEvent = ContextPressureEvent | ContextOverflowEvent | ContextRecoveryEvent;
/**
 * Context provided to a recovery strategy when it is invoked.
 * Contains everything the strategy needs to make decisions and act.
 */
export interface RecoveryContext {
    /** Current budget snapshot (reflects state before recovery) */
    readonly budget: ContextBudget;
    /** Absolute path to the `.squad/` team root directory */
    readonly teamRoot: string;
    /** Current turn index in the agent session */
    readonly turnIndex: number;
    /** History of previous recovery attempts in this session (for loop detection) */
    readonly previousAttempts: readonly RecoveryAttempt[];
    /** The coordinator state that can be checkpointed or trimmed */
    readonly coordinatorState: CoordinatorStateSnapshot;
    /** Token estimator for measuring content sizes */
    readonly estimator: TokenEstimator;
}
/**
 * Record of a previous recovery attempt (for audit trail and loop detection).
 */
export interface RecoveryAttempt {
    /** Which strategy was used */
    readonly strategyId: string;
    /** When the attempt was made (ISO 8601) */
    readonly timestamp: string;
    /** Whether it succeeded */
    readonly success: boolean;
    /** Tokens freed (0 if failed) */
    readonly tokensFreed: number;
}
/**
 * Result returned by a recovery strategy after execution.
 */
export interface RecoveryResult {
    /** Whether the strategy successfully reduced context pressure */
    readonly success: boolean;
    /** Estimated tokens freed by this strategy (0 if failed) */
    readonly tokensFreed: number;
    /** New pressure level after recovery (re-measured) */
    readonly newPressureLevel: ContextPressureLevel;
    /** Human-readable description of what was done */
    readonly summary: string;
    /**
     * If true, the coordinator must re-inject its working set from `.squad/` files.
     * Set by strategies that flush context entirely (e.g., CheckpointStrategy).
     */
    readonly requiresReinject: boolean;
}
/**
 * Serialized coordinator state saved to `.squad/checkpoints/`.
 * Must contain enough information to rebuild the coordinator's working set.
 */
export interface ContextCheckpoint {
    /** Unique checkpoint identifier (ISO 8601 timestamp-based) */
    readonly id: string;
    /** ISO 8601 timestamp when the checkpoint was created */
    readonly createdAt: string;
    /** Turn index at which the checkpoint was taken */
    readonly turnIndex: number;
    /** Pressure level that triggered checkpointing */
    readonly triggerLevel: ContextPressureLevel;
    /** Budget snapshot at checkpoint time */
    readonly budget: ContextBudget;
    /** Serialized coordinator state */
    readonly state: CoordinatorStateSnapshot;
    /** Squad version for forward-compatibility checks on restore */
    readonly squadVersion: string;
    /** Checksum of the serialized state (for integrity verification) */
    readonly checksum: string;
}
/**
 * Snapshot of coordinator state that can be serialized and restored.
 * This is the "working memory" the coordinator needs to function.
 */
export interface CoordinatorStateSnapshot {
    /** Active agent roster (parsed from team.md) */
    readonly activeAgents: readonly string[];
    /** Current routing table state */
    readonly routingDigest: string;
    /** Recent decision references (IDs, not full content) */
    readonly recentDecisionIds: readonly string[];
    /** In-flight work items (task descriptions, not full context) */
    readonly activeWorkItems: readonly WorkItemRef[];
    /** Compressed history summaries (already-summarized entries) */
    readonly historySummaries: readonly HistorySummary[];
}
/**
 * Reference to an in-flight work item (lightweight pointer, not full content).
 */
export interface WorkItemRef {
    /** Agent responsible for this work */
    readonly agent: string;
    /** Brief description of the task */
    readonly description: string;
    /** When the work was assigned (ISO 8601) */
    readonly assignedAt: string;
}
/**
 * A compressed summary of history entries (produced by SummarizeStrategy).
 */
export interface HistorySummary {
    /** Which agent's history was summarized */
    readonly agent: string;
    /** Number of original entries that were compressed */
    readonly entryCount: number;
    /** The compressed summary text */
    readonly summary: string;
    /** ISO 8601 range: earliest entry timestamp */
    readonly periodStart: string;
    /** ISO 8601 range: latest entry timestamp */
    readonly periodEnd: string;
}
/**
 * A single token usage sample persisted to the sqlite-rag analytics table.
 * Recorded on every `ctx.getContextUsage()` poll for time-series analysis.
 */
export interface TokenSample {
    /** Pi session identifier (groups samples by conversation) */
    readonly sessionId: string;
    /** ISO 8601 timestamp when the sample was recorded */
    readonly timestamp: string;
    /** Estimated tokens consumed — null when Pi reports null post-compaction */
    readonly tokens: number | null;
    /** Total context window size at time of sample (in tokens) */
    readonly contextWindow: number;
    /** Utilization percentage (0–100+) as reported by Pi */
    readonly percent: number;
    /** Computed pressure classification at sample time */
    readonly pressureLevel: ContextPressureLevel;
}
/**
 * Analytics query interface for token usage time-series data.
 * Backend-agnostic — concrete implementation targets sqlite-rag.
 */
export interface TokenAnalytics {
    /**
     * Retrieve all samples for a given session, ordered by timestamp ascending.
     * @param sessionId - The Pi session to query
     */
    querySamples(sessionId: string): Promise<TokenSample[]>;
    /**
     * Compute a trend summary over a sliding window.
     * Used by RecoveryOrchestrator for pre-emptive checkpoint decisions.
     * @param sessionId - The Pi session to query
     * @param windowMs - Lookback window in milliseconds from the most recent sample
     */
    queryTrend(sessionId: string, windowMs: number): Promise<{
        avgPercent: number;
        peakPercent: number;
        sampleCount: number;
    }>;
    /**
     * Retrieve the most recent non-null token count for a session.
     * Used as the primary recovery path when `ctx.getContextUsage()` returns
     * `tokens: null` post-compaction — avoids character-based estimation unless
     * no prior samples exist.
     * @param sessionId - The Pi session to query
     * @returns The last persisted non-null token value, or null if none exist
     */
    getLastKnownTokens(sessionId: string): Promise<number | null>;
    /**
     * List all sessions with recorded analytics data.
     * Feeds the `/session` command menu with historical context usage summaries.
     */
    listSessions(): Promise<{
        sessionId: string;
        sessionName: string;
        firstSeen: Date;
        lastSeen: Date;
        peakPercent: number;
    }[]>;
}
/**
 * Core monitoring interface for context window observation and analytics recording.
 * Implementations poll `ctx.getContextUsage()` and persist samples for trend analysis.
 */
export interface ContextMonitor {
    /** Current pressure level based on last measurement */
    readonly currentPressure: ContextPressureLevel;
    /** Most recent budget snapshot */
    readonly currentBudget: ContextBudget;
    /**
     * Record a token usage sample to persistent storage (sqlite-rag).
     * Called on every `ctx.getContextUsage()` poll cycle.
     * @param sample - The token usage data point to persist
     */
    recordTokenSample(sample: TokenSample): Promise<void>;
}
/**
 * Thrown when context overflow cannot be recovered from.
 * This is a typed, explicit failure — NOT silent degradation.
 * The coordinator must surface this to Pi/user for acknowledgement.
 */
export declare class ContextOverflowError extends Error {
    /** Budget at the time of failure */
    readonly budget: ContextBudget;
    /** Recovery attempts that were tried before giving up */
    readonly attempts: readonly RecoveryAttempt[];
    /** Turn index where the overflow was detected */
    readonly turnIndex: number;
    readonly name: "ContextOverflowError";
    constructor(message: string, 
    /** Budget at the time of failure */
    budget: ContextBudget, 
    /** Recovery attempts that were tried before giving up */
    attempts: readonly RecoveryAttempt[], 
    /** Turn index where the overflow was detected */
    turnIndex: number);
}
/**
 * Thrown when a checkpoint cannot be created (e.g., disk write failure).
 * Recovery can still proceed with other strategies.
 */
export declare class CheckpointError extends Error {
    /** The path that was being written when the error occurred */
    readonly targetPath: string;
    readonly cause?: Error | undefined;
    readonly name: "CheckpointError";
    constructor(message: string, 
    /** The path that was being written when the error occurred */
    targetPath: string, cause?: Error | undefined);
}
/**
 * Thrown when context monitoring detects an invalid configuration.
 */
export declare class ContextConfigError extends Error {
    /** Which config field is invalid */
    readonly field: string;
    /** The invalid value that was provided */
    readonly value: unknown;
    readonly name: "ContextConfigError";
    constructor(message: string, 
    /** Which config field is invalid */
    field: string, 
    /** The invalid value that was provided */
    value: unknown);
}
//# sourceMappingURL=types.d.ts.map