/**
 * @module coordinator/spawn
 *
 * Type definitions for the exec()-based spawn bridge.
 *
 * Pi's ExtensionAPI has no native subagent primitive. The spawn bridge registers
 * a tool called `squad_dispatch` via `registerTool()` whose `execute()` uses
 * `exec()` to launch pi child processes. This is the coordinator's mechanism for
 * dispatching work to Squad agents.
 *
 * Design reference: docs/ARCHITECTURE.md §4 (agent spawn), B5 research findings.
 * Implementation: Batou — these are interfaces only.
 */
// ─── Spawn Error ──────────────────────────────────────────────────────────────
/**
 * Typed error thrown when a spawned agent process fails.
 * Wraps the exit code and stderr for structured error handling.
 */
export class SpawnError extends Error {
    agentId;
    exitCode;
    stderr;
    name = "SpawnError";
    constructor(message, 
    /** Agent that failed */
    agentId, 
    /** Process exit code (non-zero) */
    exitCode, 
    /** Captured stderr from the failed process */
    stderr) {
        super(message);
        this.agentId = agentId;
        this.exitCode = exitCode;
        this.stderr = stderr;
        Object.setPrototypeOf(this, SpawnError.prototype);
    }
}
//# sourceMappingURL=spawn.js.map