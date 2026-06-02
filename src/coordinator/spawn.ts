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

// ─── Model Tiers ──────────────────────────────────────────────────────────────

/** Abstract model tier mapped to concrete model IDs by the auth adapter. */
export type ModelTier = "fast" | "balanced" | "capable";

// ─── Spawn Request ────────────────────────────────────────────────────────────

/**
 * What the coordinator hands off to the spawn bridge when dispatching an agent.
 * Constructed by the Router after a successful route match.
 */
export interface SpawnRequest {
  /** Target agent identifier (matches TeamMember.id) */
  readonly agentId: string;
  /** The task prompt forwarded to the spawned agent */
  readonly prompt: string;
  /** System prompt injected into the child agent's context */
  readonly systemPrompt: string;
  /** Model tier for this dispatch (resolved to concrete model by auth adapter) */
  readonly model?: ModelTier;
  /** Maximum execution time in milliseconds before the process is killed */
  readonly timeout: number;
  /** Pi session identifier — correlates child work back to parent session */
  readonly sessionId: string;
}

// ─── Spawn Result ─────────────────────────────────────────────────────────────

/**
 * What comes back after a spawned agent process completes.
 * Returned by `AgentHandle.wait()` or `SpawnBridge.spawnAndWait()`.
 */
export interface SpawnResult {
  /** Agent that was dispatched */
  readonly agentId: string;
  /** Captured stdout from the child process */
  readonly output: string;
  /** Process exit code (0 = success) */
  readonly exitCode: number;
  /** Wall-clock execution duration in milliseconds */
  readonly duration: number;
  /** Captured stderr if the process failed (undefined on success) */
  readonly error?: string;
}

// ─── Agent Handle ─────────────────────────────────────────────────────────────

/**
 * A live reference to a spawned agent process.
 * Allows the coordinator to cancel or await completion of dispatched work.
 */
export interface AgentHandle {
  /** OS process ID of the spawned child */
  readonly pid: number;
  /** Agent identifier this handle refers to */
  readonly agentId: string;
  /** Signal the child process to terminate. Resolves when the process exits. */
  cancel(): Promise<void>;
  /** Wait for the spawned agent to complete and return its result. */
  wait(): Promise<SpawnResult>;
}

// ─── Spawn Bridge ─────────────────────────────────────────────────────────────

/**
 * The dispatch mechanism interface.
 * Implementations register a `squad_dispatch` tool via `pi.registerTool()` and
 * use `exec()` to launch pi child processes.
 */
export interface SpawnBridge {
  /**
   * Spawn an agent and return a handle for tracking/cancellation.
   * The process begins executing immediately.
   */
  spawn(req: SpawnRequest): Promise<AgentHandle>;

  /**
   * Spawn an agent and block until it completes.
   * Convenience wrapper: equivalent to `spawn(req).then(h => h.wait())`.
   */
  spawnAndWait(req: SpawnRequest): Promise<SpawnResult>;

  /**
   * Whether the spawn bridge is operational.
   * Returns false if `exec()` is unavailable or the Pi runtime doesn't support
   * child process spawning (e.g., restricted sandbox environments).
   */
  isAvailable(): boolean;
}

// ─── Spawn Error ──────────────────────────────────────────────────────────────

/**
 * Typed error thrown when a spawned agent process fails.
 * Wraps the exit code and stderr for structured error handling.
 */
export class SpawnError extends Error {
  public readonly name = "SpawnError" as const;

  constructor(
    message: string,
    /** Agent that failed */
    public readonly agentId: string,
    /** Process exit code (non-zero) */
    public readonly exitCode: number,
    /** Captured stderr from the failed process */
    public readonly stderr: string,
  ) {
    super(message);
    Object.setPrototypeOf(this, SpawnError.prototype);
  }
}
