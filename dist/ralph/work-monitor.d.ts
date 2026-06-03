/**
 * @module ralph/work-monitor
 * Ralph's work monitor — stub implementation for v0.1.
 * Active loop and GitHub integration are out of scope; interface is correct for future wiring.
 */
export interface RalphState {
    active: boolean;
    round: number;
    stats: {
        issuesClosed: number;
        prsMerged: number;
        itemsProcessed: number;
    };
}
export interface WorkMonitor {
    start(): void;
    stop(): void;
    getState(): RalphState;
    runCheckCycle(): Promise<void>;
}
export declare function createWorkMonitor(): WorkMonitor;
//# sourceMappingURL=work-monitor.d.ts.map