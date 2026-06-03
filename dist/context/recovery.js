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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { ContextOverflowError, ContextPressureLevel } from "./types.js";
const PRESSURE_ORDER = {
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
];
const DEFAULT_SUMMARIZE_CONFIG = {
    ageThresholdTurns: 5,
    targetCompressionRatio: 0.25,
    keepRecentCount: 3,
    excludeAgents: [],
};
const DEFAULT_CHECKPOINT_CONFIG = {
    checkpointDir: "checkpoints",
    maxCheckpoints: 10,
    includeFullRouting: false,
};
const DEFAULT_DEGRADE_CONFIG = {
    dropOrder: DEFAULT_DROP_ORDER,
    alwaysRetain: ["active-work", "team-roster", "routing-rules"],
    targetUtilization: 60,
};
function classifyPressure(budget, used) {
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
function supportsLevel(current, minimum) {
    return PRESSURE_ORDER[current] >= PRESSURE_ORDER[minimum];
}
function splitEstimate(text, estimator) {
    const total = estimator.estimate(text);
    const first = Math.ceil(total / 2);
    return [first, Math.max(total - first, 0)];
}
function estimateDroppableSections(ctx) {
    const decisionText = ctx.coordinatorState.recentDecisionIds.join("\n");
    const [rootDecisionTokens, localDecisionTokens] = splitEstimate(decisionText, ctx.estimator);
    const [rootRoutingTokens, localRoutingTokens] = splitEstimate(ctx.coordinatorState.routingDigest, ctx.estimator);
    return new Map([
        ["root.decisions", rootDecisionTokens],
        ["local.decisions", localDecisionTokens],
        ["root.routing", rootRoutingTokens],
        ["local.routing", localRoutingTokens],
    ]);
}
async function readSquadVersion() {
    try {
        const raw = await readFile(new URL("../../../../squad/VERSION", import.meta.url), "utf8");
        return raw.trim() || "unknown";
    }
    catch {
        return "unknown";
    }
}
function buildCheckpointState(state, includeFullRouting) {
    return {
        ...state,
        routingDigest: includeFullRouting ? state.routingDigest : state.routingDigest,
    };
}
function checkpointIdToFilename(id) {
    return `${id}.json`;
}
function createCheckpoint(ctx, config, squadVersion) {
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
    id = "graceful-degrade";
    displayName = "Graceful Degrade";
    description = "Drops low-priority prompt sections until pressure subsides.";
    minimumLevel = ContextPressureLevel.WARNING;
    config;
    constructor(config = {}) {
        this.config = {
            ...DEFAULT_DEGRADE_CONFIG,
            ...config,
            dropOrder: config.dropOrder ?? DEFAULT_DEGRADE_CONFIG.dropOrder,
            alwaysRetain: config.alwaysRetain ?? DEFAULT_DEGRADE_CONFIG.alwaysRetain,
        };
    }
    estimateFreeable(ctx) {
        return Array.from(estimateDroppableSections(ctx).values()).reduce((total, tokens) => total + tokens, 0);
    }
    canAct(ctx) {
        return this.estimateFreeable(ctx) > 0;
    }
    async execute(ctx) {
        const sections = estimateDroppableSections(ctx);
        const targetUsed = Math.min(ctx.budget.total - 1, Math.floor((ctx.budget.total * this.config.targetUtilization) / 100));
        const requiredTokens = Math.max(ctx.budget.used - targetUsed, 0);
        const dropped = [];
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
}
;
export class DefaultSummarizeStrategy {
    id = "summarize";
    displayName = "Summarize History";
    description = "Compresses older history to keep only recent turns in active context.";
    minimumLevel = ContextPressureLevel.WARNING;
    config;
    constructor(config = {}) {
        this.config = {
            ...DEFAULT_SUMMARIZE_CONFIG,
            ...config,
            excludeAgents: config.excludeAgents ?? DEFAULT_SUMMARIZE_CONFIG.excludeAgents,
        };
    }
    estimateFreeable(ctx) {
        const removable = this.getSummarizableEntries(ctx);
        if (removable.length === 0) {
            return 0;
        }
        const sourceTokens = removable.reduce((total, entry) => total + estimateSummaryTokens(entry, ctx.estimator), 0);
        return Math.max(Math.floor(sourceTokens * (1 - this.config.targetCompressionRatio)), 0);
    }
    canAct(ctx) {
        return this.getSummarizableEntries(ctx).length > 0;
    }
    async execute(ctx) {
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
    getSummarizableEntries(ctx) {
        const eligible = ctx.coordinatorState.historySummaries.filter((entry) => !this.config.excludeAgents.includes(entry.agent));
        const keepCount = Math.max(this.config.ageThresholdTurns, this.config.keepRecentCount);
        return eligible.slice(0, Math.max(eligible.length - keepCount, 0));
    }
}
;
export class DefaultCheckpointStrategy {
    id = "checkpoint";
    displayName = "Checkpoint State";
    description = "Persists coordinator state to a checkpoint file for later recovery.";
    minimumLevel = ContextPressureLevel.CRITICAL;
    config;
    constructor(config = {}) {
        this.config = {
            ...DEFAULT_CHECKPOINT_CONFIG,
            ...config,
        };
    }
    estimateFreeable(ctx) {
        return ctx.budget.used;
    }
    canAct(_ctx) {
        return true;
    }
    async execute(ctx) {
        try {
            const checkpointDir = join(ctx.teamRoot, this.config.checkpointDir);
            const checkpoint = createCheckpoint(ctx, this.config, await readSquadVersion());
            const checkpointPath = join(checkpointDir, checkpointIdToFilename(checkpoint.id));
            await mkdir(checkpointDir, { recursive: true });
            await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
            return {
                success: true,
                tokensFreed: ctx.budget.used,
                newPressureLevel: ContextPressureLevel.NOMINAL,
                summary: `Wrote checkpoint ${basename(checkpointPath)}.`,
                requiresReinject: true,
            };
        }
        catch (error) {
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
}
;
export class DefaultEscalateStrategy {
    id = "escalate";
    displayName = "Escalate Overflow";
    description = "Throws a typed overflow error when automated recovery is exhausted.";
    minimumLevel = ContextPressureLevel.OVERFLOW;
    estimateFreeable(_ctx) {
        return 0;
    }
    canAct(_ctx) {
        return true;
    }
    async execute(ctx) {
        throw new ContextOverflowError("Context window exceeded capacity and could not be recovered automatically.", ctx.budget, ctx.previousAttempts, ctx.turnIndex);
    }
}
;
export class DefaultRecoveryOrchestrator {
    stores;
    strategies;
    attemptHistory = [];
    constructor(stores, strategies = [
        new DefaultGracefulDegradeStrategy(),
        new DefaultSummarizeStrategy(),
        new DefaultCheckpointStrategy(),
        new DefaultEscalateStrategy(),
    ]) {
        this.stores = stores;
        this.strategies = [...strategies];
    }
    register(strategy) {
        if (this.strategies.some((registered) => registered.id === strategy.id)) {
            throw new Error(`Recovery strategy already registered: ${strategy.id}`);
        }
        this.strategies.push(strategy);
    }
    getStrategiesForLevel(level) {
        return this.strategies
            .filter((strategy) => supportsLevel(level, strategy.minimumLevel))
            .map((strategy) => strategy.id);
    }
    getAttemptHistory() {
        return [...this.attemptHistory];
    }
    reset() {
        this.attemptHistory.length = 0;
    }
    async recover(levelOrCtx, maybeCtx) {
        const level = typeof levelOrCtx === "string"
            ? levelOrCtx
            : levelOrCtx.budget.pressureLevel;
        const ctx = typeof levelOrCtx === "string"
            ? maybeCtx
            : levelOrCtx;
        if (!ctx) {
            throw new ContextOverflowError("Recovery context is required.", createEmptyBudget(), this.getAttemptHistory(), 0);
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
                    void this.stores.root;
                    return result;
                }
            }
            catch (error) {
                if (error instanceof ContextOverflowError) {
                    throw new ContextOverflowError(error.message, error.budget, this.getAttemptHistory(), error.turnIndex);
                }
                this.recordAttempt(strategy.id, false, 0);
            }
        }
        throw new ContextOverflowError("All recovery strategies failed to reduce context pressure.", ctx.budget, this.getAttemptHistory(), ctx.turnIndex);
    }
    recordAttempt(strategyId, success, tokensFreed) {
        this.attemptHistory.push({
            strategyId,
            timestamp: new Date().toISOString(),
            success,
            tokensFreed,
        });
    }
}
;
function estimateSummaryTokens(entry, estimator) {
    return estimator.estimate([entry.agent, entry.summary, entry.periodStart, entry.periodEnd].join("\n"));
}
function createEmptyBudget() {
    return {
        total: 0,
        used: 0,
        available: 0,
        pressureLevel: ContextPressureLevel.NOMINAL,
        utilizationPercent: 0,
        measuredAt: new Date(0).toISOString(),
    };
}
//# sourceMappingURL=recovery.js.map