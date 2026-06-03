/**
 * @module ralph/work-monitor
 * Ralph's native work monitor for observing Pi session and .squad work state.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
const HOOK_TIMEOUT_MS = 10_000;
const STALLED_SESSION_MS = 15 * 60 * 1_000;
const SESSION_REASONS = ["startup", "reload", "new", "resume", "fork"];
function withTimeout(promise, ms, hookName) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`[pi-squad] ${hookName} hook timed out after ${ms}ms`)), ms);
        }),
    ]);
}
function createInitialState() {
    return {
        active: false,
        startedAt: null,
        lastEventAt: null,
        session: {
            reason: null,
            turnCount: 0,
            agentRuns: 0,
            compactionsObserved: 0,
        },
        work: {
            inboxCount: 0,
            inboxChangedAt: null,
            teamRoot: null,
        },
        health: {
            contextPercent: null,
            contextPressure: null,
            lastRecoveryAt: null,
        },
        findings: [],
    };
}
function isSessionReason(value) {
    return typeof value === "string" && SESSION_REASONS.includes(value);
}
function cloneFinding(finding) {
    return {
        ...finding,
        metadata: finding.metadata ? { ...finding.metadata } : undefined,
    };
}
function cloneState(state) {
    return {
        active: state.active,
        startedAt: state.startedAt,
        lastEventAt: state.lastEventAt,
        session: { ...state.session },
        work: { ...state.work },
        health: { ...state.health },
        findings: state.findings.map(cloneFinding),
    };
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function getContextPercent(ctx) {
    if (!isRecord(ctx) || typeof ctx.getContextUsage !== "function") {
        return null;
    }
    const usage = ctx.getContextUsage();
    if (!isRecord(usage) || typeof usage.percent !== "number" || Number.isNaN(usage.percent)) {
        return null;
    }
    return usage.percent;
}
function countMarkdownFiles(entries) {
    return entries.filter((entry) => entry.name.endsWith(".md")).length;
}
function classifyContextPressure(percent) {
    if (percent === null) {
        return null;
    }
    if (percent >= 100) {
        return "overflow";
    }
    if (percent >= 90) {
        return "critical";
    }
    if (percent >= 70) {
        return "warning";
    }
    return "nominal";
}
class WorkMonitorImpl {
    deps;
    logger;
    clock;
    listeners = new Set();
    state = createInitialState();
    constructor(deps) {
        this.deps = deps;
        this.logger = deps.logger ?? console;
        this.clock = deps.clock ?? (() => new Date());
    }
    async start() {
        if (this.state.active) {
            return;
        }
        const timestamp = this.now();
        this.state.active = true;
        this.state.startedAt = this.state.startedAt ?? timestamp;
        this.state.lastEventAt = timestamp;
        this.emitStateChanged();
        this.logger.log("[pi-squad] Ralph work monitor started.");
    }
    async stop(reason = "shutdown") {
        if (!this.state.active) {
            return;
        }
        this.state.active = false;
        this.state.lastEventAt = this.now();
        this.emitStateChanged();
        this.logger.log(`[pi-squad] Ralph work monitor stopped (${reason}).`);
    }
    getState() {
        return cloneState(this.state);
    }
    async refresh(reason) {
        const timestamp = this.now();
        const emitted = [];
        this.detectStalledSession(timestamp, reason, emitted);
        const stack = await this.deps.coordinator.getTeamStack();
        const teamRoot = stack.local.path;
        const inboxPath = join(teamRoot, ".squad", "decisions", "inbox");
        const previousCount = this.state.work.inboxCount;
        const nextCount = await this.scanInbox(inboxPath);
        this.state.active = true;
        this.state.lastEventAt = timestamp;
        this.state.work.teamRoot = teamRoot;
        if (previousCount !== nextCount) {
            this.state.work.inboxChangedAt = timestamp;
            emitted.push(this.recordFinding({
                kind: "inbox-changed",
                severity: "info",
                message: `Inbox changed from ${previousCount} to ${nextCount} markdown file${nextCount === 1 ? "" : "s"}.`,
                detectedAt: timestamp,
                source: ".squad",
                metadata: {
                    previousCount,
                    inboxCount: nextCount,
                    refreshReason: reason,
                    teamRoot,
                },
            }));
        }
        this.state.work.inboxCount = nextCount;
        if (nextCount > 0) {
            this.syncConditionFinding("inbox-nonempty", {
                kind: "inbox-nonempty",
                severity: "info",
                message: "Inbox contains pending decision markdown files.",
                detectedAt: timestamp,
                source: ".squad",
                metadata: { teamRoot },
            }, emitted);
        }
        else {
            this.removeFinding("inbox-nonempty");
        }
        if (reason === "agent-end") {
            this.state.session.agentRuns += 1;
        }
        this.emitStateChanged();
        return emitted.map(cloneFinding);
    }
    async recordContextAssessment(assessment) {
        try {
            this.syncContextPressure(assessment.budget.utilizationPercent, "coordinator", true);
        }
        catch (error) {
            this.logger.warn(`[pi-squad] Ralph failed to record context assessment; continuing. ${String(error)}`);
        }
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    async handleSessionStart(event) {
        const timestamp = this.now();
        const reason = isRecord(event) && isSessionReason(event.reason) ? event.reason : null;
        const nextState = createInitialState();
        nextState.active = true;
        nextState.startedAt = timestamp;
        nextState.lastEventAt = timestamp;
        nextState.session.reason = reason;
        this.replaceState(nextState);
        if (reason === "resume") {
            this.recordFinding({
                kind: "session-resumed",
                severity: "info",
                message: "Pi resumed an existing session.",
                detectedAt: timestamp,
                source: "pi",
                metadata: { reason },
            });
        }
        await this.refresh("session-start");
    }
    async handleTurnEnd(ctx) {
        this.state.active = true;
        this.state.lastEventAt = this.now();
        this.state.session.turnCount += 1;
        const percent = getContextPercent(ctx);
        if (percent !== null) {
            this.syncContextPressure(percent, "pi", true);
            return;
        }
        this.emitStateChanged();
    }
    async handleBeforeCompact(ctx) {
        const timestamp = this.now();
        this.state.active = true;
        this.state.lastEventAt = timestamp;
        this.state.session.compactionsObserved += 1;
        const percent = getContextPercent(ctx);
        if (percent !== null) {
            this.updateHealth(percent, timestamp);
        }
        this.recordFinding({
            kind: "compaction-observed",
            severity: "info",
            message: "Pi reported a session compaction checkpoint.",
            detectedAt: timestamp,
            source: "pi",
            metadata: {
                compactionsObserved: this.state.session.compactionsObserved,
                contextPercent: percent,
            },
        });
        this.emitStateChanged();
    }
    now() {
        return this.clock().toISOString();
    }
    replaceState(nextState) {
        this.state.active = nextState.active;
        this.state.startedAt = nextState.startedAt;
        this.state.lastEventAt = nextState.lastEventAt;
        this.state.session.reason = nextState.session.reason;
        this.state.session.turnCount = nextState.session.turnCount;
        this.state.session.agentRuns = nextState.session.agentRuns;
        this.state.session.compactionsObserved = nextState.session.compactionsObserved;
        this.state.work.inboxCount = nextState.work.inboxCount;
        this.state.work.inboxChangedAt = nextState.work.inboxChangedAt;
        this.state.work.teamRoot = nextState.work.teamRoot;
        this.state.health.contextPercent = nextState.health.contextPercent;
        this.state.health.contextPressure = nextState.health.contextPressure;
        this.state.health.lastRecoveryAt = nextState.health.lastRecoveryAt;
        this.state.findings.splice(0, this.state.findings.length, ...nextState.findings);
        this.emitStateChanged();
    }
    emit(event) {
        for (const listener of this.listeners) {
            try {
                listener(event);
            }
            catch (error) {
                this.logger.warn(`[pi-squad] Ralph listener failed; continuing. ${String(error)}`);
            }
        }
    }
    emitStateChanged() {
        this.emit({ type: "state-changed", state: this.getState() });
    }
    recordFinding(finding) {
        const index = this.state.findings.findIndex((entry) => entry.kind === finding.kind);
        if (index >= 0) {
            this.state.findings.splice(index, 1, finding);
        }
        else {
            this.state.findings.push(finding);
        }
        this.emit({ type: "finding", finding: cloneFinding(finding) });
        return finding;
    }
    syncConditionFinding(kind, finding, emitted) {
        if (this.state.findings.some((entry) => entry.kind === kind)) {
            return;
        }
        emitted.push(this.recordFinding(finding));
    }
    removeFinding(kind) {
        const index = this.state.findings.findIndex((entry) => entry.kind === kind);
        if (index >= 0) {
            this.state.findings.splice(index, 1);
        }
    }
    detectStalledSession(timestamp, reason, emitted) {
        if (!this.state.lastEventAt) {
            return;
        }
        const elapsed = this.clock().getTime() - new Date(this.state.lastEventAt).getTime();
        if (elapsed < STALLED_SESSION_MS) {
            return;
        }
        emitted.push(this.recordFinding({
            kind: "stalled-session",
            severity: "warning",
            message: "Session activity appears stalled between Ralph checkpoints.",
            detectedAt: timestamp,
            source: "pi",
            metadata: {
                stalledMs: elapsed,
                refreshReason: reason,
            },
        }));
    }
    updateHealth(percent, timestamp) {
        const nextPressure = classifyContextPressure(percent);
        const previousPressure = this.state.health.contextPressure;
        this.state.lastEventAt = timestamp;
        this.state.health.contextPercent = percent;
        this.state.health.contextPressure = nextPressure;
        if (previousPressure !== null &&
            previousPressure !== "nominal" &&
            nextPressure === "nominal") {
            this.state.health.lastRecoveryAt = timestamp;
        }
    }
    syncContextPressure(percent, source, emitState) {
        const timestamp = this.now();
        this.state.active = true;
        this.updateHealth(percent, timestamp);
        if (percent >= 90) {
            this.removeFinding("context-warning");
            this.syncConditionFinding("context-critical", {
                kind: "context-critical",
                severity: "critical",
                message: percent >= 100
                    ? "Context pressure overflow observed; recovery is urgent."
                    : "Context pressure is in the critical range.",
                detectedAt: timestamp,
                source,
            }, []);
        }
        else if (percent >= 70) {
            this.removeFinding("context-critical");
            this.syncConditionFinding("context-warning", {
                kind: "context-warning",
                severity: "warning",
                message: "Context pressure is in the warning range.",
                detectedAt: timestamp,
                source,
            }, []);
        }
        else {
            this.removeFinding("context-warning");
            this.removeFinding("context-critical");
        }
        if (emitState) {
            this.emitStateChanged();
        }
    }
    async scanInbox(inboxPath) {
        try {
            const entries = await readdir(inboxPath, { withFileTypes: true });
            return countMarkdownFiles(entries.filter((entry) => entry.isFile()));
        }
        catch (error) {
            if (isRecord(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
                return 0;
            }
            throw error;
        }
    }
}
async function runHook(logger, hookName, hookWork) {
    try {
        await withTimeout(hookWork(), HOOK_TIMEOUT_MS, hookName);
    }
    catch (error) {
        logger.warn(`[pi-squad] ${hookName} hook failed; continuing. ${String(error)}`);
    }
}
export async function initializeWorkMonitor(pi, deps) {
    const monitor = new WorkMonitorImpl(deps);
    const logger = deps.logger ?? console;
    pi.on("session_start", async (event) => {
        await runHook(logger, "session_start", async () => {
            await monitor.handleSessionStart(event);
        });
    });
    pi.on("before_agent_start", async () => {
        await runHook(logger, "before_agent_start", async () => {
            await monitor.refresh("before-agent-start");
        });
    });
    pi.on("agent_end", async () => {
        await runHook(logger, "agent_end", async () => {
            await monitor.refresh("agent-end");
        });
    });
    pi.on("turn_end", async (_event, ctx) => {
        await runHook(logger, "turn_end", async () => {
            await monitor.handleTurnEnd(ctx);
        });
    });
    pi.on("session_before_compact", async (_event, ctx) => {
        await runHook(logger, "session_before_compact", async () => {
            await monitor.handleBeforeCompact(ctx);
        });
    });
    pi.on("session_shutdown", async () => {
        await runHook(logger, "session_shutdown", async () => {
            await monitor.stop("shutdown");
        });
    });
    await monitor.start();
    return monitor;
}
//# sourceMappingURL=work-monitor.js.map