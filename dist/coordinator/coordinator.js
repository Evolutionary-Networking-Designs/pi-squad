/**
 * @module coordinator/coordinator
 * Core coordinator object — initializes Squad state and wires Pi lifecycle hooks.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ContextPressureLevel } from "../context/types.js";
import { checkCompatibility } from "../upstream/version.js";
import { getCompositeSystemPrompt } from "./composite-prompt.js";
import { MAX_PROMPT_CHARS, getSystemPrompt } from "./system-prompt.js";
import { resolveTeamStack } from "./team-stack.js";
const SQUAD_AGENT_MD = fileURLToPath(new URL("../../../../squad/.github/agents/squad.agent.md", import.meta.url));
const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
const CHARS_PER_TOKEN = 4;
class CharApproxEstimator {
    method = "char-approx";
    estimate(content) {
        return Math.max(1, Math.ceil(content.length / CHARS_PER_TOKEN));
    }
}
class FallbackContextMonitor {
    contextWindowSize;
    estimator;
    lastBudget = null;
    constructor(contextWindowSize = DEFAULT_CONTEXT_WINDOW_TOKENS, estimator = new CharApproxEstimator()) {
        this.contextWindowSize = contextWindowSize;
        this.estimator = estimator;
    }
    measure(content) {
        const used = this.estimator.estimate(content);
        const utilizationPercent = (used / this.contextWindowSize) * 100;
        const budget = {
            total: this.contextWindowSize,
            used,
            available: this.contextWindowSize - used,
            utilizationPercent,
            pressureLevel: this.classify(utilizationPercent),
            measuredAt: new Date().toISOString(),
        };
        this.lastBudget = budget;
        return budget;
    }
    classify(utilizationPercent) {
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
    getLastBudget() {
        return this.lastBudget;
    }
}
async function readFileSafe(filePath) {
    try {
        return await readFile(filePath, "utf8");
    }
    catch {
        return null;
    }
}
async function readSquadMeta() {
    try {
        const pkgPath = new URL("../../package.json", import.meta.url).pathname;
        const raw = await readFile(pkgPath, "utf8");
        const pkg = JSON.parse(raw);
        return pkg.squad ?? null;
    }
    catch {
        return null;
    }
}
async function readSquadVersion(teamRoot) {
    const versionPath = resolve(new URL("../../../../squad/VERSION", import.meta.url).pathname);
    const fromVendored = await readFileSafe(versionPath);
    if (fromVendored) {
        return fromVendored.trim();
    }
    return readFileSafe(join(teamRoot, ".squad", "VERSION"));
}
async function readAgentPrompt() {
    const agentPrompt = await readFile(SQUAD_AGENT_MD, "utf8");
    return agentPrompt.trim();
}
async function loadRecoveryRuntime() {
    try {
        const [recoveryModule, storeModule] = await Promise.all([
            import("../context/recovery.js"),
            import("../context/store.js"),
        ]);
        return {
            RecoveryOrchestrator: recoveryModule.RecoveryOrchestrator,
            createRecoveryOrchestrator: recoveryModule.createRecoveryOrchestrator,
            createSessionStore: storeModule.createSessionStore,
            createStore: storeModule.createStore,
        };
    }
    catch (error) {
        console.warn(`[pi-squad] Context recovery modules unavailable; continuing without recovery orchestration. ${String(error)}`);
        return {};
    }
}
function buildCoordinatorStateSnapshot(stack) {
    const activeAgents = Array.from(new Set([...stack.root.config.agents, ...stack.local.config.agents]));
    return {
        activeAgents,
        routingDigest: stack.root.config.sourceHash,
        recentDecisionIds: [],
        activeWorkItems: [],
        historySummaries: [],
    };
}
class CoordinatorImpl {
    _pi;
    _teamStack = null;
    monitor = new FallbackContextMonitor();
    recoveryRuntimePromise = null;
    warnedFeatures = new Set();
    turnIndex = 0;
    constructor(_pi) {
        this._pi = _pi;
    }
    async getTeamRoot() {
        return (await this.getTeamStack()).root.path;
    }
    async getTeamStack() {
        if (!this._teamStack) {
            this._teamStack = await resolveTeamStack();
        }
        return this._teamStack;
    }
    async getSystemPrompt() {
        const stack = await this.getTeamStack();
        if (stack.isSingleTeam) {
            return getSystemPrompt(stack.root.path);
        }
        try {
            return await getCompositeSystemPrompt(stack, await readAgentPrompt(), MAX_PROMPT_CHARS);
        }
        catch (error) {
            this.warnOnce("composite-prompt", `[pi-squad] Failed to assemble composite coordinator prompt; falling back to root prompt. ${String(error)}`);
            return getSystemPrompt(stack.root.path);
        }
    }
    async assessContext(content, history = []) {
        const measuredContent = [content, ...history].filter((part) => part.length > 0).join("\n\n");
        const budget = this.monitor.measure(measuredContent);
        const triggerLevel = budget.pressureLevel === ContextPressureLevel.NOMINAL ? null : budget.pressureLevel;
        const assessment = {
            budget,
            recoveryNeeded: budget.pressureLevel === ContextPressureLevel.CRITICAL ||
                budget.pressureLevel === ContextPressureLevel.OVERFLOW,
            triggerLevel,
        };
        if (assessment.recoveryNeeded) {
            await this.attemptRecovery(assessment, content, history);
        }
        this.turnIndex += 1;
        return assessment;
    }
    async route(message, _ctx) {
        const stack = await this.getTeamStack();
        console.log(`[pi-squad] route (${stack.local.config.name}): ${message}`);
    }
    async attemptRecovery(assessment, content, history) {
        const runtime = await this.getRecoveryRuntime();
        const createSessionStore = runtime.createSessionStore ?? runtime.createStore;
        if (!createSessionStore) {
            this.warnOnce("create-session-store", "[pi-squad] Context recovery store unavailable; skipping recovery orchestration.");
            return;
        }
        if (!assessment.triggerLevel) {
            return;
        }
        const stack = await this.getTeamStack();
        const stores = {
            root: createSessionStore(stack.root.squadPath),
            local: stack.isSingleTeam ? undefined : createSessionStore(stack.local.squadPath),
        };
        try {
            if (typeof runtime.RecoveryOrchestrator === "function") {
                await this.invokeRecovery(new runtime.RecoveryOrchestrator(stores), assessment, content, history, stack);
                return;
            }
            const orchestrator = await this.createRecoveryOrchestrator(runtime, stores);
            if (orchestrator) {
                await this.invokeRecovery(orchestrator, assessment, content, history, stack);
                return;
            }
        }
        catch (error) {
            this.warnOnce("recovery-failed", `[pi-squad] Context recovery failed; continuing with current prompt. ${String(error)}`);
            return;
        }
        this.warnOnce("recovery-runtime", "[pi-squad] RecoveryOrchestrator runtime unavailable; context recovery remains disabled.");
    }
    async invokeRecovery(orchestrator, assessment, content, history, stack) {
        if (!assessment.triggerLevel) {
            return;
        }
        if (orchestrator.recover.length >= 2) {
            await orchestrator.recover(assessment.triggerLevel, {
                budget: assessment.budget,
                teamRoot: stack.root.path,
                turnIndex: this.turnIndex,
                previousAttempts: orchestrator.getAttemptHistory?.() ?? [],
                coordinatorState: buildCoordinatorStateSnapshot(stack),
                estimator: this.monitor.estimator,
            });
            return;
        }
        await orchestrator.recover({
            currentPrompt: content,
            history: [...history],
            budget: assessment.budget,
            teamStack: stack,
        });
    }
    async createRecoveryOrchestrator(runtime, stores) {
        if (typeof runtime.createRecoveryOrchestrator === "function") {
            return runtime.createRecoveryOrchestrator(stores);
        }
        return null;
    }
    async getRecoveryRuntime() {
        if (!this.recoveryRuntimePromise) {
            this.recoveryRuntimePromise = loadRecoveryRuntime();
        }
        return this.recoveryRuntimePromise;
    }
    warnOnce(key, message) {
        if (this.warnedFeatures.has(key)) {
            return;
        }
        this.warnedFeatures.add(key);
        console.warn(message);
    }
}
// ─── Factory ──────────────────────────────────────────────────────────────────
export async function initializeCoordinator(pi) {
    const coordinator = new CoordinatorImpl(pi);
    pi.on("turn_end", async (_event, ctx) => {
        try {
            const usage = ctx.getContextUsage();
            if (usage) {
                console.log(`[pi-squad] turn_end: ${usage.percent?.toFixed(1) ?? "?"}% context used`);
            }
        }
        catch {
            // Non-critical — swallow monitoring errors
        }
    });
    pi.on("session_start", async (event) => {
        const reason = event.reason;
        if (reason === "startup" || reason === "resume") {
            const teamRoot = await coordinator.getTeamRoot();
            const [meta, version] = await Promise.all([readSquadMeta(), readSquadVersion(teamRoot)]);
            if (meta && version) {
                const result = checkCompatibility(version, meta);
                if (!result.compatible) {
                    console.warn(`[pi-squad] Squad version warning: ${result.reason}`);
                }
            }
        }
    });
    pi.on("session_before_compact", async (_event, ctx) => {
        try {
            const usage = ctx.getContextUsage();
            console.log(`[pi-squad] session_before_compact: saving checkpoint at ${usage?.percent?.toFixed(1) ?? "?"}% context`);
        }
        catch {
            // Non-critical
        }
    });
    return coordinator;
}
//# sourceMappingURL=coordinator.js.map