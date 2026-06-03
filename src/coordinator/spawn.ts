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

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { AgentSpawnDirective, RouteDispatchContext } from "./router.js";

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

export interface SpawnedExecutionResult {
  readonly kind: "spawned";
  readonly request: SpawnRequest;
  readonly result: SpawnResult;
}

export interface NoopSpawnResult {
  readonly kind: "noop";
  readonly request: SpawnRequest;
  readonly reason: string;
}

export type SpawnExecutionResult = SpawnedExecutionResult | NoopSpawnResult;

interface SpawnRuntimeContext {
  readonly pi?: ExtensionAPI;
  readonly cwd?: string;
  readonly signal?: AbortSignal;
  readonly logger?: Pick<Console, "info" | "warn" | "error" | "debug">;
  readonly sessionId: string;
}

const DEFAULT_SPAWN_TIMEOUT_MS = 120_000;

function buildSpawnRequest(directive: AgentSpawnDirective, ctx: SpawnRuntimeContext): SpawnRequest {
  return {
    agentId: directive.agentId,
    prompt: directive.prompt,
    systemPrompt: directive.systemPrompt ?? "",
    model: directive.model,
    timeout: directive.timeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS,
    sessionId: ctx.sessionId,
  };
}

function buildSpawnPrompt(req: SpawnRequest): string {
  const systemSection = req.systemPrompt.trim();
  if (systemSection.length === 0) {
    return req.prompt;
  }

  return `${systemSection}\n\n---\n\n${req.prompt}`;
}

function hasExecApi(pi: ExtensionAPI | undefined): pi is ExtensionAPI {
  return Boolean(pi && typeof pi.exec === "function");
}

export async function spawnSquadAgent(
  directive: AgentSpawnDirective,
  ctx: SpawnRuntimeContext | RouteDispatchContext,
): Promise<SpawnExecutionResult> {
  const logger = ctx.logger ?? console;
  const request = buildSpawnRequest(directive, {
    sessionId: ctx.sessionId,
    pi: "pi" in ctx ? ctx.pi : undefined,
    cwd: ctx.cwd,
    signal: ctx.signal,
    logger,
  });

  const piCandidate = "pi" in ctx ? ctx.pi : undefined;
  if (!hasExecApi(piCandidate)) {
    logger.warn(`[pi-squad] Spawn API unavailable; skipped spawn for ${request.agentId}.`);
    return {
      kind: "noop",
      request,
      reason: "Pi ExtensionAPI exec() is unavailable in this runtime",
    };
  }

  const pi = piCandidate;
  const spawnedPrompt = buildSpawnPrompt(request);
  const startedAt = Date.now();
  const execResult = await pi.exec("pi", ["-p", spawnedPrompt], {
    cwd: ctx.cwd,
    timeout: request.timeout,
    signal: ctx.signal,
  });

  const duration = Date.now() - startedAt;
  const result: SpawnResult = {
    agentId: request.agentId,
    output: execResult.stdout,
    exitCode: execResult.code,
    duration,
    error: execResult.code === 0 ? undefined : execResult.stderr || "spawned process exited non-zero",
  };

  if (execResult.code !== 0) {
    logger.warn(
      `[pi-squad] Spawned agent ${request.agentId} exited with code ${execResult.code}.`,
    );
  }

  return {
    kind: "spawned",
    request,
    result,
  };
}
