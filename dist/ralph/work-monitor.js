/**
 * @module ralph/work-monitor
 * Ralph's work monitor — stub implementation for v0.1.
 * Active loop and GitHub integration are out of scope; interface is correct for future wiring.
 */
export function createWorkMonitor() {
    const state = {
        active: false,
        round: 0,
        stats: { issuesClosed: 0, prsMerged: 0, itemsProcessed: 0 },
    };
    return {
        start() {
            state.active = true;
            console.log("[Ralph] Work monitor started.");
        },
        stop() {
            state.active = false;
            console.log("[Ralph] Work monitor stopped.");
        },
        getState() {
            return { ...state, stats: { ...state.stats } };
        },
        async runCheckCycle() {
            console.log("Ralph: checking work queue...");
        },
    };
}
//# sourceMappingURL=work-monitor.js.map