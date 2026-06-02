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

export function createWorkMonitor(): WorkMonitor {
  const state: RalphState = {
    active: false,
    round: 0,
    stats: { issuesClosed: 0, prsMerged: 0, itemsProcessed: 0 },
  };

  return {
    start(): void {
      state.active = true;
      console.log("[Ralph] Work monitor started.");
    },

    stop(): void {
      state.active = false;
      console.log("[Ralph] Work monitor stopped.");
    },

    getState(): RalphState {
      return { ...state, stats: { ...state.stats } };
    },

    async runCheckCycle(): Promise<void> {
      console.log("Ralph: checking work queue...");
    },
  };
}

