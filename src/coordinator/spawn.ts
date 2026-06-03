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

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { AgentSpawnDirective, RouteDispatchContext } from "./router.js";

// ─── Model Tiers ──────────────────────────────────────────────────────────────

/** Abstract model tier mapped to concrete model IDs by the auth adapter. */
export type ModelTier = "fast" | "balanced" | "capable";

/** Inline tier→model mapping. Will be extracted to src/auth/adapter.ts in a future PR. */
const MODEL_TIERS: Record<string, Record<ModelTier, string>> = {
  copilot:   { fast: "claude-haiku-4.5",  balanced: "claude-sonnet-4.6", capable: "claude-opus-4.5"  },
  codex:     { fast: "gpt-5-mini",        balanced: "gpt-5.5",           capable: "gpt-5.3-codex"    },
  anthropic: { fast: "claude-haiku-4.5",  balanced: "claude-sonnet-4.6", capable: "claude-opus-4.5"  },
  ollama:    { fast: "llama3.2:3b",       balanced: "llama3.2:70b",      capable: "llama3.2:70b"      },
};

function detectProvider(pi: ExtensionAPI): string {
  const getDefaultModel = (pi as unknown as { getDefaultModel?: () => string }).getDefaultModel;
  if (typeof getDefaultModel === "function") {
    const modelId = getDefaultModel.call(pi);
    if (typeof modelId === "string") {
      if (modelId.startsWith("claude-")) return "copilot";
      if (modelId.startsWith("gpt-"))    return "codex";
      if (modelId.startsWith("llama"))   return "ollama";
    }
  }
  return "codex";
}

function resolveModelId(tier: ModelTier, pi: ExtensionAPI): string {
  const provider = detectProvider(pi);
  return (MODEL_TIERS[provider] ?? MODEL_TIERS.codex)[tier];
}

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

async function writeSystemPromptFile(req: SpawnRequest): Promise<string | null> {
  const systemPrompt = req.systemPrompt.trim();
  if (systemPrompt.length === 0) {
    return null;
  }

  const dir = await mkdtemp(join(tmpdir(), "pi-squad-agent-"));
  const filePath = join(dir, `${req.agentId.replace(/[^a-z0-9_-]/giu, "_")}-system.md`);
  await writeFile(filePath, systemPrompt, { encoding: "utf8", mode: 0o600 });
  return filePath;
}

async function cleanupSystemPromptFile(filePath: string | null): Promise<void> {
  if (!filePath) {
    return;
  }

  const dir = dirname(filePath);
  await rm(filePath, { force: true });
  await rm(dir, { force: true, recursive: true });
}

async function loadCharterContent(agentId: string, cwd: string | undefined): Promise<string | null> {
  if (!cwd) return null;
  const charterPath = join(cwd, ".squad", "agents", agentId, "charter.md");
  try {
    return await readFile(charterPath, { encoding: "utf8" });
  } catch {
    return null;
  }
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

  // P2: load charter and merge into system prompt so agents always have identity context
  const charter = await loadCharterContent(request.agentId, ctx.cwd);
  const amendedRequest: SpawnRequest = charter
    ? {
        ...request,
        systemPrompt: request.systemPrompt.trim().length === 0
          ? charter
          : `${charter}\n\n${request.systemPrompt}`,
      }
    : request;

  const systemPromptFile = await writeSystemPromptFile(amendedRequest);
  const args = ["--no-extensions", "--mode", "json", "--no-session"];

  // P1: resolve model tier to concrete model ID for the child process
  if (amendedRequest.model) {
    const modelId = resolveModelId(amendedRequest.model, pi);
    args.push("--model", modelId);
  }

  if (systemPromptFile) {
    args.push("--append-system-prompt", systemPromptFile);
  }
  args.push("-p", amendedRequest.prompt);

  const startedAt = Date.now();
  let execResult: Awaited<ReturnType<ExtensionAPI["exec"]>>;
  try {
    execResult = await pi.exec("pi", args, {
      cwd: ctx.cwd,
      timeout: amendedRequest.timeout,
      signal: ctx.signal,
    });
  } finally {
    await cleanupSystemPromptFile(systemPromptFile);
  }

  const duration = Date.now() - startedAt;
  const result: SpawnResult = {
    agentId: amendedRequest.agentId,
    output: execResult.stdout,
    exitCode: execResult.code,
    duration,
    error: execResult.code === 0 ? undefined : execResult.stderr || "spawned process exited non-zero",
  };

  if (execResult.code !== 0) {
    logger.warn(
      `[pi-squad] Spawned agent ${amendedRequest.agentId} exited with code ${execResult.code}.`,
    );
  }

  return {
    kind: "spawned",
    request: amendedRequest,
    result,
  };
}

const SquadDispatchParams = Type.Object({
  agentId: Type.String({ description: "Lowercase Squad agent id to dispatch, for example batou or togusa." }),
  prompt: Type.String({ description: "The complete task prompt for the named agent." }),
  systemPrompt: Type.Optional(Type.String({ description: "Agent-specific system prompt or charter to inject." })),
  model: Type.Optional(
    Type.Union([
      Type.Literal("fast"),
      Type.Literal("balanced"),
      Type.Literal("capable"),
    ]),
  ),
  timeoutMs: Type.Optional(Type.Number({ description: "Maximum child-agent runtime in milliseconds." })),
});

interface SquadDispatchParamsValue {
  readonly agentId: string;
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly model?: ModelTier;
  readonly timeoutMs?: number;
}

function isModelTier(value: unknown): value is ModelTier {
  return value === "fast" || value === "balanced" || value === "capable";
}

function parseDispatchParams(value: unknown): SquadDispatchParamsValue | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.agentId !== "string" || typeof record.prompt !== "string") {
    return null;
  }

  return {
    agentId: record.agentId,
    prompt: record.prompt,
    systemPrompt: typeof record.systemPrompt === "string" ? record.systemPrompt : undefined,
    model: isModelTier(record.model) ? record.model : undefined,
    timeoutMs: typeof record.timeoutMs === "number" ? record.timeoutMs : undefined,
  };
}

export function registerSquadDispatchTool(pi: ExtensionAPI): void {
  if (typeof pi.registerTool !== "function") {
    return;
  }

  pi.registerTool({
    name: "squad_dispatch",
    label: "Squad Dispatch",
    description:
      "Dispatch work to a named Squad specialist agent in an isolated Pi child process. Use this instead of doing specialist implementation, review, test, security, docs, or design work inline.",
    promptSnippet:
      "Dispatch work to named Squad agents with squad_dispatch instead of doing specialist work inline",
    promptGuidelines: [
      "Use squad_dispatch for any task that needs a Squad specialist; the coordinator routes and synthesizes, it does not implement inline.",
      "Pass the lowercase agent id in agentId and include the full agent task in prompt.",
      "Use --no-extensions child isolation is handled by the tool; do not ask the child agent to route again.",
    ],
    parameters: SquadDispatchParams as never,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const typed = parseDispatchParams(params);
      if (!typed) {
        return {
          content: [{ type: "text", text: "Invalid squad_dispatch parameters." }],
          details: { ok: false, reason: "invalid_parameters" },
        };
      }

      onUpdate?.({
        content: [{ type: "text", text: `Dispatching ${typed.agentId}...` }],
        details: { agentId: typed.agentId, status: "running" },
      });

      const result = await spawnSquadAgent(
        {
          type: "agent_spawn",
          agentId: typed.agentId,
          prompt: typed.prompt,
          systemPrompt: typed.systemPrompt,
          model: typed.model,
          timeoutMs: typed.timeoutMs,
        },
        {
          pi,
          sessionId: `session-${Date.now()}`,
          cwd: ctx.cwd,
          signal,
          logger: console,
        },
      );

      if (result.kind === "noop") {
        return {
          content: [{ type: "text", text: `Could not dispatch ${typed.agentId}: ${result.reason}` }],
          details: { ok: false, ...result },
        };
      }

      return {
        content: [{ type: "text", text: result.result.output || `(no output from ${typed.agentId})` }],
        details: { ok: result.result.exitCode === 0, ...result },
        isError: result.result.exitCode !== 0,
      };
    },
  } as Parameters<ExtensionAPI["registerTool"]>[0]);
}
