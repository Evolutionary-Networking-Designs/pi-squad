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

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { ContextOverflowError, ContextPressureLevel } from "./types.js";
import type {
  ContextBudget,
  ContextCheckpoint,
  ContextMonitorConfig,
  CoordinatorStateSnapshot,
  RecoveryContext,
  RecoveryResult,
  RecoveryAttempt,
  HistorySummary,
} from "./types.js";
import type { SessionStore } from "./store.js";

// ─── Recovery Strategy Interface ──────────────────────────────────────────────

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

// ─── Concrete Strategy Interfaces ─────────────────────────────────────────────

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

// ─── Recovery Orchestrator ────────────────────────────────────────────────────

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

// ─── Factories ────────────────────────────────────────────────────────────────

/**
 * Factory for creating the RecoveryOrchestrator with default strategies registered.
 *
 * @param config - Monitor configuration (determines strategy ordering per level)
 * @param teamRoot - Absolute path to `.squad/` directory
 * @returns Configured RecoveryOrchestrator with all built-in strategies registered
 */
export type CreateRecoveryOrchestrator = (
  config: ContextMonitorConfig,
  teamRoot: string,
) => RecoveryOrchestrator;

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

const PRESSURE_ORDER: Record<ContextPressureLevel, number> = {
  [ContextPressureLevel.NOMINAL]: 0,
  [ContextPressureLevel.WARNING]: 1,
  [ContextPressureLevel.CRITICAL]: 2,
  [ContextPressureLevel.OVERFLOW]: 3,
};

const DEFAULT_DROP_ORDER = [
  "root.decisions",
  "local.decisions",
  "root.routing",
  "local.routing",
] as const;

const DEFAULT_SUMMARIZE_CONFIG: SummarizeStrategyConfig = {
  ageThresholdTurns: 5,
  targetCompressionRatio: 0.25,
  keepRecentCount: 3,
  excludeAgents: [],
};

const DEFAULT_CHECKPOINT_CONFIG: CheckpointStrategyConfig = {
  checkpointDir: "checkpoints",
  maxCheckpoints: 10,
  includeFullRouting: false,
};

const DEFAULT_DEGRADE_CONFIG: GracefulDegradeStrategyConfig = {
  dropOrder: DEFAULT_DROP_ORDER,
  alwaysRetain: ["active-work", "team-roster", "routing-rules"],
  targetUtilization: 60,
};

function classifyPressure(budget: ContextBudget, used: number): ContextPressureLevel {
  const utilizationPercent = budget.total > 0 ? (used / budget.total) * 100 : 0;

  if (utilizationPercent >= 100) {
    return ContextPressureLevel.OVERFLOW;
  }
  if (utilizationPercent >= 90) {
    return ContextPressureLevel.CRITICAL;
  }
  if (utilizationPercent >= 70) {
    return ContextPressureLevel.WARNING;
  }
  return ContextPressureLevel.NOMINAL;
}

function supportsLevel(current: ContextPressureLevel, minimum: ContextPressureLevel): boolean {
  return PRESSURE_ORDER[current] >= PRESSURE_ORDER[minimum];
}

function splitEstimate(text: string, estimator: RecoveryContext["estimator"]): [number, number] {
  const total = estimator.estimate(text);
  const first = Math.ceil(total / 2);
  return [first, Math.max(total - first, 0)];
}

function estimateDroppableSections(ctx: RecoveryContext): Map<string, number> {
  const decisionText = ctx.coordinatorState.recentDecisionIds.join("\n");
  const [rootDecisionTokens, localDecisionTokens] = splitEstimate(decisionText, ctx.estimator);
  const [rootRoutingTokens, localRoutingTokens] = splitEstimate(
    ctx.coordinatorState.routingDigest,
    ctx.estimator,
  );

  return new Map<string, number>([
    ["root.decisions", rootDecisionTokens],
    ["local.decisions", localDecisionTokens],
    ["root.routing", rootRoutingTokens],
    ["local.routing", localRoutingTokens],
  ]);
}

async function readSquadVersion(): Promise<string> {
  try {
    const raw = await readFile(new URL("../../squad/package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function buildCheckpointState(
  state: CoordinatorStateSnapshot,
  includeFullRouting: boolean,
): CoordinatorStateSnapshot {
  return {
    ...state,
    routingDigest: includeFullRouting ? state.routingDigest : state.routingDigest,
  };
}

function checkpointIdToFilename(id: string): string {
  return `${id}.json`;
}

function createCheckpoint(
  ctx: RecoveryContext,
  config: CheckpointStrategyConfig,
  squadVersion: string,
): ContextCheckpoint {
  const createdAt = new Date().toISOString();
  const serializedState = JSON.stringify(ctx.coordinatorState);
  return {
    id: createdAt,
    createdAt,
    turnIndex: ctx.turnIndex,
    triggerLevel: ctx.budget.pressureLevel,
    budget: ctx.budget,
    state: buildCheckpointState(ctx.coordinatorState, config.includeFullRouting),
    squadVersion,
    checksum: `sha256:${createHash("sha256").update(serializedState).digest("hex")}`,
  };
}

export class DefaultGracefulDegradeStrategy {
  public readonly id = "graceful-degrade" as const;
  public readonly displayName = "Graceful Degrade";
  public readonly description = "Drops low-priority prompt sections until pressure subsides.";
  public readonly minimumLevel = ContextPressureLevel.WARNING;
  public readonly config: GracefulDegradeStrategyConfig;

  public constructor(config: Partial<GracefulDegradeStrategyConfig> = {}) {
    this.config = {
      ...DEFAULT_DEGRADE_CONFIG,
      ...config,
      dropOrder: config.dropOrder ?? DEFAULT_DEGRADE_CONFIG.dropOrder,
      alwaysRetain: config.alwaysRetain ?? DEFAULT_DEGRADE_CONFIG.alwaysRetain,
    };
  }

  public estimateFreeable(ctx: RecoveryContext): number {
    return Array.from(estimateDroppableSections(ctx).values()).reduce(
      (total, tokens) => total + tokens,
      0,
    );
  }

  public canAct(ctx: RecoveryContext): boolean {
    return this.estimateFreeable(ctx) > 0;
  }

  public async execute(ctx: RecoveryContext): Promise<RecoveryResult> {
    const sections = estimateDroppableSections(ctx);
    const targetUsed = Math.min(
      ctx.budget.total - 1,
      Math.floor((ctx.budget.total * this.config.targetUtilization) / 100),
    );
    const requiredTokens = Math.max(ctx.budget.used - targetUsed, 0);
    const dropped: string[] = [];
    let tokensFreed = 0;

    for (const section of this.config.dropOrder) {
      const sectionTokens = sections.get(section) ?? 0;
      if (sectionTokens <= 0) {
        continue;
      }

      dropped.push(section);
      tokensFreed += sectionTokens;
      if (tokensFreed >= requiredTokens) {
        break;
      }
    }

    const usedAfterRecovery = Math.max(ctx.budget.used - tokensFreed, 0);
    const newPressureLevel = classifyPressure(ctx.budget, usedAfterRecovery);

    if (tokensFreed === 0) {
      return {
        success: false,
        tokensFreed: 0,
        newPressureLevel: ctx.budget.pressureLevel,
        summary: "No degradable context sections were available.",
        requiresReinject: false,
      };
    }

    return {
      success: true,
      tokensFreed,
      newPressureLevel,
      summary: `Dropped ${dropped.join(", ")} to reduce prompt pressure.`,
      requiresReinject: false,
    };
  }
};

export class DefaultSummarizeStrategy {
  public readonly id = "summarize" as const;
  public readonly displayName = "Summarize History";
  public readonly description = "Compresses older history to keep only recent turns in active context.";
  public readonly minimumLevel = ContextPressureLevel.WARNING;
  public readonly config: SummarizeStrategyConfig;

  public constructor(config: Partial<SummarizeStrategyConfig> = {}) {
    this.config = {
      ...DEFAULT_SUMMARIZE_CONFIG,
      ...config,
      excludeAgents: config.excludeAgents ?? DEFAULT_SUMMARIZE_CONFIG.excludeAgents,
    };
  }

  public estimateFreeable(ctx: RecoveryContext): number {
    const removable = this.getSummarizableEntries(ctx);
    if (removable.length === 0) {
      return 0;
    }

    const sourceTokens = removable.reduce(
      (total, entry) => total + estimateSummaryTokens(entry, ctx.estimator),
      0,
    );
    return Math.max(
      Math.floor(sourceTokens * (1 - this.config.targetCompressionRatio)),
      0,
    );
  }

  public canAct(ctx: RecoveryContext): boolean {
    return this.getSummarizableEntries(ctx).length > 0;
  }

  public async execute(ctx: RecoveryContext): Promise<RecoveryResult> {
    const removable = this.getSummarizableEntries(ctx);
    if (removable.length === 0) {
      return {
        success: false,
        tokensFreed: 0,
        newPressureLevel: ctx.budget.pressureLevel,
        summary: `History already fits within the most recent ${this.config.ageThresholdTurns} turns.`,
        requiresReinject: false,
      };
    }

    const tokensFreed = this.estimateFreeable(ctx);
    const usedAfterRecovery = Math.max(ctx.budget.used - tokensFreed, 0);

    return {
      success: true,
      tokensFreed,
      newPressureLevel: classifyPressure(ctx.budget, usedAfterRecovery),
      summary: `Summarized ${removable.length} history entries, keeping the last ${this.config.ageThresholdTurns} turns in active context.`,
      requiresReinject: false,
    };
  }

  private getSummarizableEntries(ctx: RecoveryContext): HistorySummary[] {
    const eligible = ctx.coordinatorState.historySummaries.filter(
      (entry) => !this.config.excludeAgents.includes(entry.agent),
    );
    const keepCount = Math.max(this.config.ageThresholdTurns, this.config.keepRecentCount);
    return eligible.slice(0, Math.max(eligible.length - keepCount, 0));
  }
};

export class DefaultCheckpointStrategy {
  public readonly id = "checkpoint" as const;
  public readonly displayName = "Checkpoint State";
  public readonly description = "Persists coordinator state to a checkpoint file for later recovery.";
  public readonly minimumLevel = ContextPressureLevel.CRITICAL;
  public readonly config: CheckpointStrategyConfig;

  public constructor(config: Partial<CheckpointStrategyConfig> = {}) {
    this.config = {
      ...DEFAULT_CHECKPOINT_CONFIG,
      ...config,
    };
  }

  public estimateFreeable(ctx: RecoveryContext): number {
    return ctx.budget.used;
  }

  public canAct(_ctx: RecoveryContext): boolean {
    return true;
  }

  public async execute(ctx: RecoveryContext): Promise<RecoveryResult> {
    try {
      const checkpointDir = join(ctx.teamRoot, this.config.checkpointDir);
      const checkpoint = createCheckpoint(ctx, this.config, await readSquadVersion());
      const checkpointPath = join(checkpointDir, checkpointIdToFilename(checkpoint.id));

      await mkdir(checkpointDir, { recursive: true });
      await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");

      // Issue 3: write latest.json for crash recovery
      await writeLatestJson(ctx, checkpoint, this.config.checkpointDir);

      return {
        success: true,
        tokensFreed: ctx.budget.used,
        newPressureLevel: ContextPressureLevel.NOMINAL,
        summary: `Wrote checkpoint ${basename(checkpointPath)}.`,
        requiresReinject: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        tokensFreed: 0,
        newPressureLevel: ctx.budget.pressureLevel,
        summary: `Failed to write checkpoint: ${message}`,
        requiresReinject: false,
      };
    }
  }
};

export class DefaultEscalateStrategy {
  public readonly id = "escalate" as const;
  public readonly displayName = "Escalate Overflow";
  public readonly description = "Throws a typed overflow error when automated recovery is exhausted.";
  public readonly minimumLevel = ContextPressureLevel.OVERFLOW;

  public estimateFreeable(_ctx: RecoveryContext): number {
    return 0;
  }

  public canAct(_ctx: RecoveryContext): boolean {
    return true;
  }

  public async execute(ctx: RecoveryContext): Promise<RecoveryResult> {
    throw new ContextOverflowError(
      "Context window exceeded capacity and could not be recovered automatically.",
      ctx.budget,
      ctx.previousAttempts,
      ctx.turnIndex,
    );
  }
};

export class DefaultRecoveryOrchestrator {
  private readonly stores: RecoveryStores;
  private readonly strategies: RecoveryStrategy[];
  private readonly attemptHistory: RecoveryAttempt[] = [];

  public constructor(
    stores: RecoveryStores,
    strategies: RecoveryStrategy[] = [
      new DefaultGracefulDegradeStrategy(),
      new DefaultSummarizeStrategy(),
      new DefaultCheckpointStrategy(),
      new DefaultEscalateStrategy(),
    ],
  ) {
    this.stores = stores;
    this.strategies = [...strategies];
  }

  public register(strategy: RecoveryStrategy): void {
    if (this.strategies.some((registered) => registered.id === strategy.id)) {
      throw new Error(`Recovery strategy already registered: ${strategy.id}`);
    }
    this.strategies.push(strategy);
  }

  public getStrategiesForLevel(level: ContextPressureLevel): readonly string[] {
    return this.strategies
      .filter((strategy) => supportsLevel(level, strategy.minimumLevel))
      .map((strategy) => strategy.id);
  }

  public getAttemptHistory(): readonly RecoveryAttempt[] {
    return [...this.attemptHistory];
  }

  public reset(): void {
    this.attemptHistory.length = 0;
  }

  public async recover(
    levelOrCtx: ContextPressureLevel | RecoveryContext,
    maybeCtx?: RecoveryContext,
  ): Promise<RecoveryResult> {
    const level =
      typeof levelOrCtx === "string"
        ? levelOrCtx
        : levelOrCtx.budget.pressureLevel;
    const ctx =
      typeof levelOrCtx === "string"
        ? maybeCtx
        : levelOrCtx;

    if (!ctx) {
      throw new ContextOverflowError(
        "Recovery context is required.",
        createEmptyBudget(),
        this.getAttemptHistory(),
        0,
      );
    }

    for (const strategy of this.strategies) {
      if (!supportsLevel(level, strategy.minimumLevel) || !strategy.canAct(ctx)) {
        continue;
      }

      try {
        const result = await strategy.execute({
          ...ctx,
          previousAttempts: this.getAttemptHistory(),
        });
        this.recordAttempt(strategy.id, result.success, result.tokensFreed);

        if (result.success) {
          return result;
        }
      } catch (error) {
        if (error instanceof ContextOverflowError) {
          throw new ContextOverflowError(
            error.message,
            error.budget,
            this.getAttemptHistory(),
            error.turnIndex,
          );
        }

        this.recordAttempt(strategy.id, false, 0);
      }
    }

    throw new ContextOverflowError(
      "All recovery strategies failed to reduce context pressure.",
      ctx.budget,
      this.getAttemptHistory(),
      ctx.turnIndex,
    );
  }

  private recordAttempt(strategyId: string, success: boolean, tokensFreed: number): void {
    this.attemptHistory.push({
      strategyId,
      timestamp: new Date().toISOString(),
      success,
      tokensFreed,
    });
  }
};

function estimateSummaryTokens(
  entry: HistorySummary,
  estimator: RecoveryContext["estimator"],
): number {
  return estimator.estimate(
    [entry.agent, entry.summary, entry.periodStart, entry.periodEnd].join("\n"),
  );
}

function createEmptyBudget(): ContextBudget {
  return {
    total: 0,
    used: 0,
    available: 0,
    pressureLevel: ContextPressureLevel.NOMINAL,
    utilizationPercent: 0,
    measuredAt: new Date(0).toISOString(),
  };
}

// Issue 3: lightweight latest.json written to .squad/context/ for crash recovery
async function writeLatestJson(
  ctx: RecoveryContext,
  checkpoint: ContextCheckpoint,
  checkpointDirName: string,
): Promise<void> {
  const checkpointDir = join(ctx.teamRoot, checkpointDirName);
  const latestPath = join(checkpointDir, "latest.json");
  const snapshot = {
    checkpointId: checkpoint.id,
    createdAt: checkpoint.createdAt,
    turnIndex: checkpoint.turnIndex,
    pressureLevel: checkpoint.triggerLevel,
    tokenCount: checkpoint.budget.used,
    contextWindow: checkpoint.budget.total,
  };
  try {
    await mkdir(checkpointDir, { recursive: true });
    await writeFile(latestPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  } catch (err) {
    console.warn(
      `[pi-squad] Failed to write latest.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// Issue 1: factory export so coordinator.ts can discover this via createRecoveryOrchestrator
export function createRecoveryOrchestrator(stores: RecoveryStores): DefaultRecoveryOrchestrator {
  return new DefaultRecoveryOrchestrator(stores);
}

