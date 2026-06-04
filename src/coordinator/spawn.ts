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

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  /** Resolved pi-subagents built-in backing this Squad persona */
  readonly piBuiltin?: string;
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

export interface CharterRejectDirective {
  readonly type: "charter_reject";
  readonly agentId: string;
  readonly reason: string;
  readonly suggestedAgent?: string;
}

export interface ReassessmentSpawnResult {
  readonly kind: "reassess";
  readonly request: SpawnRequest;
  readonly directive: CharterRejectDirective;
  readonly reason: string;
}

export type SpawnExecutionResult = SpawnedExecutionResult | NoopSpawnResult | ReassessmentSpawnResult;

interface SpawnRuntimeContext {
  readonly pi?: ExtensionAPI;
  readonly cwd?: string;
  readonly signal?: AbortSignal;
  readonly logger?: Pick<Console, "info" | "warn" | "error" | "debug">;
  readonly sessionId: string;
}

interface ResolvedSquadAgent {
  readonly piBuiltin?: string;
}

interface PromptArtifact {
  readonly dirPath: string;
  readonly filePath: string;
}

const DEFAULT_SPAWN_TIMEOUT_MS = 120_000;

function buildSpawnRequest(
  directive: AgentSpawnDirective,
  ctx: SpawnRuntimeContext,
  resolvedAgent?: ResolvedSquadAgent,
): SpawnRequest {
  return {
    agentId: directive.agentId,
    prompt: directive.prompt,
    systemPrompt: directive.systemPrompt ?? "",
    piBuiltin: resolvedAgent?.piBuiltin,
    model: directive.model,
    timeout: directive.timeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS,
    sessionId: ctx.sessionId,
  };
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-z0-9_-]/giu, "_");
}

function buildBuiltinOverlay(req: SpawnRequest): string | null {
  if (!req.piBuiltin) {
    return null;
  }

  return [
    "## Execution Layer",
    `Run this Squad assignment through the pi-subagents built-in \`${req.piBuiltin}\` execution path.`,
    "Preserve the Squad persona and charter as the authoritative identity context.",
  ].join("\n");
}

function composeSystemPrompt(req: SpawnRequest, charter: string | null): string {
  return [charter?.trim(), buildBuiltinOverlay(req), req.systemPrompt.trim()]
    .filter((section): section is string => typeof section === "string" && section.length > 0)
    .join("\n\n");
}

async function writeSystemPromptFile(req: SpawnRequest, baseDir: string | undefined): Promise<PromptArtifact | null> {
  const systemPrompt = req.systemPrompt.trim();
  if (systemPrompt.length === 0) {
    return null;
  }

  const rootDir = join(baseDir ?? process.cwd(), ".pi-squad-runtime", "spawn-prompts");
  const dirPath = join(
    rootDir,
    `${safePathSegment(req.sessionId)}-${Date.now()}-${process.pid}`,
  );
  const filePath = join(dirPath, `${safePathSegment(req.agentId)}-system.md`);
  await mkdir(dirPath, { recursive: true });
  await writeFile(filePath, systemPrompt, { encoding: "utf8", mode: 0o600 });
  return { dirPath, filePath };
}

async function cleanupSystemPromptFile(artifact: PromptArtifact | null): Promise<void> {
  if (!artifact) {
    return;
  }

  await rm(artifact.dirPath, { force: true, recursive: true });
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

function parseCharterRejectDirective(value: unknown): CharterRejectDirective | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    record.type === "charter_reject" &&
    typeof record.agentId === "string" &&
    typeof record.reason === "string"
  ) {
    return {
      type: "charter_reject",
      agentId: record.agentId,
      reason: record.reason,
      suggestedAgent: typeof record.suggestedAgent === "string" ? record.suggestedAgent : undefined,
    };
  }

  if (Array.isArray(record.content)) {
    for (const item of record.content) {
      const nested = parseCharterRejectDirective(item);
      if (nested) {
        return nested;
      }
    }
  }

  if (typeof record.text === "string") {
    try {
      return parseCharterRejectDirective(JSON.parse(record.text));
    } catch {
      return null;
    }
  }

  if (typeof record.message === "object" && record.message !== null) {
    return parseCharterRejectDirective(record.message);
  }

  return null;
}

function findCharterReject(output: string): CharterRejectDirective | null {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const directive = parseCharterRejectDirective(parsed);
      if (directive) {
        return directive;
      }
    } catch {
      // Ignore non-JSON lines in mixed output.
    }
  }

  return null;
}

function formatReassessmentMessage(directive: CharterRejectDirective): string {
  return directive.suggestedAgent
    ? `Agent '${directive.agentId}' rejected the task: ${directive.reason} Reassess and consider '${directive.suggestedAgent}'.`
    : `Agent '${directive.agentId}' rejected the task: ${directive.reason} Reassess the dispatch target.`;
}

function hasExecApi(pi: ExtensionAPI | undefined): pi is ExtensionAPI {
  return Boolean(pi && typeof pi.exec === "function");
}

export async function spawnSquadAgent(
  directive: AgentSpawnDirective,
  ctx: (SpawnRuntimeContext | RouteDispatchContext) & { readonly resolvedAgent?: ResolvedSquadAgent },
): Promise<SpawnExecutionResult> {
  const logger = ctx.logger ?? console;
  const request = buildSpawnRequest(directive, {
    sessionId: ctx.sessionId,
    pi: "pi" in ctx ? ctx.pi : undefined,
    cwd: ctx.cwd,
    signal: ctx.signal,
    logger,
  }, ctx.resolvedAgent);

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

  const charter = await loadCharterContent(request.agentId, ctx.cwd);
  const amendedRequest: SpawnRequest = {
    ...request,
    systemPrompt: composeSystemPrompt(request, charter),
  };

  const systemPromptFile = await writeSystemPromptFile(amendedRequest, ctx.cwd);
  const args = ["--mode", "json", "--no-session"];

  if (amendedRequest.model) {
    const modelId = resolveModelId(amendedRequest.model, pi);
    args.push("--model", modelId);
  }

  if (systemPromptFile) {
    args.push("--append-system-prompt", systemPromptFile.filePath);
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

  const charterReject = findCharterReject(execResult.stdout);
  if (charterReject) {
    return {
      kind: "reassess",
      request: amendedRequest,
      directive: charterReject,
      reason: formatReassessmentMessage(charterReject),
    };
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
      "squad_dispatch preserves Squad identity and charter context while delegating execution to the child Pi runtime; do not call subagent directly when a Squad persona is required.",
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

      if (result.kind === "reassess") {
        return {
          content: [{ type: "text", text: result.reason }],
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
