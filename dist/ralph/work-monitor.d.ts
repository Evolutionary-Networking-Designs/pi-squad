/**
 * @module ralph/work-monitor
 * Ralph's native work monitor for observing Pi session and .squad work state.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ContextAssessment } from "../context/monitor.js";
import type { Coordinator } from "../coordinator/coordinator.js";
export type RalphFindingKind = "inbox-nonempty" | "inbox-changed" | "context-warning" | "context-critical" | "compaction-observed" | "session-resumed" | "stalled-session";
export interface RalphFinding {
    readonly kind: RalphFindingKind;
    readonly severity: "info" | "warning" | "critical";
    readonly message: string;
    readonly detectedAt: string;
    readonly source: "pi" | ".squad" | "coordinator";
    readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}
export interface RalphState {
    readonly active: boolean;
    readonly startedAt: string | null;
    readonly lastEventAt: string | null;
    readonly session: {
        readonly reason: "startup" | "reload" | "new" | "resume" | "fork" | null;
        readonly turnCount: number;
        readonly agentRuns: number;
        readonly compactionsObserved: number;
    };
    readonly work: {
        readonly inboxCount: number;
        readonly inboxChangedAt: string | null;
        readonly teamRoot: string | null;
    };
    readonly health: {
        readonly contextPercent: number | null;
        readonly contextPressure: "nominal" | "warning" | "critical" | "overflow" | null;
        readonly lastRecoveryAt: string | null;
    };
    readonly findings: readonly RalphFinding[];
}
export type RalphRefreshReason = "session-start" | "before-agent-start" | "agent-end" | "turn-end" | "before-compact" | "manual";
export type RalphListener = (event: RalphMonitorEvent) => void;
export type RalphMonitorEvent = {
    readonly type: "state-changed";
    readonly state: RalphState;
} | {
    readonly type: "finding";
    readonly finding: RalphFinding;
};
export interface WorkMonitor {
    start(): Promise<void>;
    stop(reason?: "shutdown" | "reload"): Promise<void>;
    getState(): RalphState;
    refresh(reason: RalphRefreshReason): Promise<readonly RalphFinding[]>;
    recordContextAssessment(assessment: ContextAssessment): Promise<void>;
    subscribe(listener: RalphListener): () => void;
}
export interface WorkMonitorDependencies {
    readonly coordinator: Pick<Coordinator, "getTeamStack">;
    readonly logger?: Pick<Console, "log" | "warn" | "error">;
    readonly clock?: () => Date;
}
export declare function initializeWorkMonitor(pi: ExtensionAPI, deps: WorkMonitorDependencies): Promise<WorkMonitor>;
//# sourceMappingURL=work-monitor.d.ts.map