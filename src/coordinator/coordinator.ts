/**
 * @module coordinator/coordinator
 * Core coordinator object — initializes Squad state and wires Pi lifecycle hooks.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { ContextPressureLevel, type ContextBudget, type CoordinatorStateSnapshot, type TokenEstimator } from "../context/types.js";
import type { ContextAssessment } from "../context/monitor.js";
import type { TeamStack } from "../types.js";
import { checkCompatibility } from "../upstream/version.js";
import { GuardChecker } from "./guard.js";
import { getCompositeSystemPrompt } from "./composite-prompt.js";
import {
  RouteDispatcher,
  type RouteDirective,
  type RouteDispatchResult,
  type UnknownDirective,
} from "./router.js";
import { MAX_PROMPT_CHARS, getSystemPrompt as loadSystemPrompt } from "./system-prompt.js";
import { resolveTeamStack } from "./team-stack.js";

const SQUAD_AGENT_MD = fileURLToPath(
  new URL("../../../../squad/.github/agents/squad.agent.md", import.meta.url),
);
const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
const CHARS_PER_TOKEN = 4;

type RecoveryStoreFactory = (squadPath: string) => Promise<unknown> | unknown;

type RecoveryOrchestratorLike = {
  recover: (...args: unknown[]) => Promise<unknown>;
  getAttemptHistory?: () => readonly unknown[];
};

interface RecoveryRuntime {
  readonly createSessionStore?: RecoveryStoreFactory;
  readonly createStore?: RecoveryStoreFactory;
  readonly RecoveryOrchestrator?: new (stores: unknown) => RecoveryOrchestratorLike;
  readonly createRecoveryOrchestrator?: (...args: unknown[]) => RecoveryOrchestratorLike;
}

class CharApproxEstimator implements TokenEstimator {
  readonly method = "char-approx";

  estimate(content: string): number {
    return Math.max(1, Math.ceil(content.length / CHARS_PER_TOKEN));
  }
}

class FallbackContextMonitor {
  readonly estimator: TokenEstimator;

  private lastBudget: ContextBudget | null = null;

  constructor(
    private readonly contextWindowSize: number = DEFAULT_CONTEXT_WINDOW_TOKENS,
    estimator: TokenEstimator = new CharApproxEstimator(),
  ) {
    this.estimator = estimator;
  }

  measure(content: string): ContextBudget {
    const used = this.estimator.estimate(content);
    const utilizationPercent = (used / this.contextWindowSize) * 100;
    const budget: ContextBudget = {
      total: this.contextWindowSize,
      used,
      available: this.contextWindowSize - used,
      utilizationPercent,
      pressureLevel: this.classify(utilizationPercent),
      measuredAt: new Date().toISOString(),
    };

    this.lastBudget = budget;
    return budget;
  }

  classify(utilizationPercent: number): ContextPressureLevel {
    if (utilizationPercent >= 100) {
      return ContextPressureLevel.OVERFLOW;
    }
    if (utilizationPercent >= 90) {
      return ContextPressureLevel.CRITICAL;
    }
    if (utilizationPercent >= 70) {
      return ContextPressureLevel.WARNING;
    }
    return ContextPressureLevel.NOMINAL;
  }

  getLastBudget(): ContextBudget | null {
    return this.lastBudget;
  }
}

// ─── Public Interface ─────────────────────────────────────────────────────────

export interface InitContext {
  readonly userName: string | null;
  readonly detectedExtensions: readonly string[];
  readonly projectName: string;
}

export interface Coordinator {
  route(message: string, ctx: unknown): Promise<void>;
  getSystemPrompt(): Promise<string>;
  getTeamRoot(): Promise<string>;
  getTeamStack(): Promise<TeamStack>;
  assessContext(content: string, history?: readonly string[]): Promise<ContextAssessment>;
  setInitMode(ctx: InitContext): void;
  clearInitMode(): void;
  isInitMode(): boolean;
  getInitContext(): InitContext | null;
}

interface PackageSquadMeta {
  version: string;
  minVersion: string;
  maxVersion: string;
}

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readSquadMeta(): Promise<PackageSquadMeta | null> {
  try {
    const pkgPath = new URL("../../package.json", import.meta.url).pathname;
    const raw = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { squad?: PackageSquadMeta };
    return pkg.squad ?? null;
  } catch {
    return null;
  }
}

async function readSquadVersion(teamRoot: string): Promise<string | null> {
  const versionPath = resolve(new URL("../../../../squad/VERSION", import.meta.url).pathname);
  const fromVendored = await readFileSafe(versionPath);
  if (fromVendored) {
    return fromVendored.trim();
  }

  return readFileSafe(join(teamRoot, ".squad", "VERSION"));
}

async function readAgentPrompt(): Promise<string> {
  const agentPrompt = await readFile(SQUAD_AGENT_MD, "utf8");
  return agentPrompt.trim();
}

async function loadRecoveryRuntime(): Promise<RecoveryRuntime> {
  try {
    const [recoveryModule, storeModule] = await Promise.all([
      import("../context/recovery.js"),
      import("../context/store.js"),
    ]);

    return {
      RecoveryOrchestrator: (recoveryModule as RecoveryRuntime).RecoveryOrchestrator,
      createRecoveryOrchestrator: (recoveryModule as RecoveryRuntime).createRecoveryOrchestrator,
      createSessionStore: (storeModule as RecoveryRuntime).createSessionStore,
      createStore: (storeModule as RecoveryRuntime).createStore,
    };
  } catch (error) {
    console.warn(
      `[pi-squad] Context recovery modules unavailable; continuing without recovery orchestration. ${String(
        error,
      )}`,
    );
    return {};
  }
}

function buildCoordinatorStateSnapshot(stack: TeamStack): CoordinatorStateSnapshot {
  const activeAgents = Array.from(new Set([...stack.root.config.agents, ...stack.local.config.agents]));

  return {
    activeAgents,
    routingDigest: stack.root.config.sourceHash,
    recentDecisionIds: [],
    activeWorkItems: [],
    historySummaries: [],
  };
}

type RouteContext = {
  readonly sessionId: string;
  readonly cwd?: string;
  readonly signal?: AbortSignal;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parseRouteDirective(message: string): RouteDirective {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return { type: "unknown", originalType: "empty", payload: { message } };
  }

  if (!trimmed.startsWith("{")) {
    return { type: "direct_response", message: trimmed };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const record = asRecord(parsed);
    if (!record || typeof record.type !== "string") {
      return { type: "direct_response", message: trimmed };
    }

    if (record.type === "agent_spawn") {
      const prompt = asOptionalString(record.prompt);
      const agentId = asOptionalString(record.agentId);
      return {
        type: "agent_spawn",
        prompt: prompt ?? "",
        agentId: agentId ?? "",
        model:
          record.model === "fast" || record.model === "balanced" || record.model === "capable"
            ? record.model
            : undefined,
        systemPrompt: asOptionalString(record.systemPrompt),
        timeoutMs: typeof record.timeoutMs === "number" ? record.timeoutMs : undefined,
        parentAgentId: asOptionalString(record.parentAgentId),
        spawnPath: Array.isArray(record.spawnPath)
          ? record.spawnPath.filter((entry): entry is string => typeof entry === "string")
          : undefined,
      };
    }

    if (record.type === "squad_update") {
      return {
        type: "squad_update",
        message: asOptionalString(record.message) ?? "",
        details: asOptionalString(record.details),
      };
    }

    if (record.type === "direct_response") {
      return {
        type: "direct_response",
        message: asOptionalString(record.message) ?? "",
      };
    }

    const unknownDirective: UnknownDirective = {
      type: "unknown",
      originalType: record.type,
      payload: record,
    };
    return unknownDirective;
  } catch {
    return { type: "direct_response", message: trimmed };
  }
}

class CoordinatorImpl implements Coordinator {
  private _teamStack: TeamStack | null = null;
  private readonly monitor = new FallbackContextMonitor();
  private recoveryRuntimePromise: Promise<RecoveryRuntime> | null = null;
  private readonly warnedFeatures = new Set<string>();
  private turnIndex = 0;
  private initContext: InitContext | null = null;

  constructor(private readonly _pi: ExtensionAPI) {}

  async getTeamRoot(): Promise<string> {
    return (await this.getTeamStack()).root.path;
  }

  async getTeamStack(): Promise<TeamStack> {
    if (!this._teamStack) {
      this._teamStack = await resolveTeamStack();
    }
    return this._teamStack;
  }

  async getSystemPrompt(): Promise<string> {
    if (this.isInitMode()) {
      return loadSystemPrompt(process.cwd());
    }

    const stack = await this.getTeamStack();

    if (stack.isSingleTeam) {
      return loadSystemPrompt(stack.root.path);
    }

    try {
      return await getCompositeSystemPrompt(stack, await readAgentPrompt(), MAX_PROMPT_CHARS);
    } catch (error) {
      this.warnOnce(
        "composite-prompt",
        `[pi-squad] Failed to assemble composite coordinator prompt; falling back to root prompt. ${String(
          error,
        )}`,
      );
      return loadSystemPrompt(stack.root.path);
    }
  }

  async assessContext(
    content: string,
    history: readonly string[] = [],
  ): Promise<ContextAssessment> {
    const measuredContent = [content, ...history].filter((part) => part.length > 0).join("\n\n");
    const budget = this.monitor.measure(measuredContent);
    const triggerLevel =
      budget.pressureLevel === ContextPressureLevel.NOMINAL ? null : budget.pressureLevel;
    const assessment: ContextAssessment = {
      budget,
      recoveryNeeded:
        budget.pressureLevel === ContextPressureLevel.CRITICAL ||
        budget.pressureLevel === ContextPressureLevel.OVERFLOW,
      triggerLevel,
    };

    if (assessment.recoveryNeeded) {
      await this.attemptRecovery(assessment, content, history);
    }

    this.turnIndex += 1;
    return assessment;
  }

  setInitMode(ctx: InitContext): void {
    this.initContext = ctx;
  }

  clearInitMode(): void {
    this.initContext = null;
  }

  isInitMode(): boolean {
    return this.initContext !== null;
  }

  getInitContext(): InitContext | null {
    return this.initContext;
  }

  async route(message: string, ctx: unknown): Promise<void> {
    const stack = await this.getTeamStack();
    const routeContext = this.resolveRouteContext(ctx);
    const rawDirective = parseRouteDirective(message);
    const guard = new GuardChecker();
    const checked = guard.validate(rawDirective as { type: string } & Record<string, unknown>);

    if (!checked.ok) {
      console.warn(
        `[pi-squad] route guard violation (${checked.violation.code}): ${checked.violation.message}`,
      );
      this.emitRouteLifecycle("guard_violation", {
        team: stack.local.config.name,
        messageLength: message.length,
        violationCode: checked.violation.code,
        sessionId: routeContext.sessionId,
      });
      return;
    }

    this.emitRouteLifecycle("guard_passed", {
      team: stack.local.config.name,
      directiveType: checked.directive.type,
      sessionId: routeContext.sessionId,
    });

    const dispatcher = new RouteDispatcher({
      pi: this._pi,
      sessionId: routeContext.sessionId,
      cwd: routeContext.cwd,
      signal: routeContext.signal,
      logger: console,
    });

    let result: RouteDispatchResult;
    try {
      result = await dispatcher.dispatch(checked.directive);
    } catch (error) {
      console.warn(`[pi-squad] route dispatch failed: ${String(error)}`);
      this.emitRouteLifecycle("dispatch_failed", {
        team: stack.local.config.name,
        directiveType: checked.directive.type,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorLength: error instanceof Error ? error.message.length : String(error).length,
        sessionId: routeContext.sessionId,
      });
      return;
    }

    this.emitRouteLifecycle("dispatch_completed", {
      team: stack.local.config.name,
      directiveType: result.directiveType,
      status: result.status,
      resultLength: typeof result.message === "string" ? result.message.length : 0,
      sessionId: routeContext.sessionId,
    });
  }

  private async attemptRecovery(
    assessment: ContextAssessment,
    content: string,
    history: readonly string[],
  ): Promise<void> {
    const runtime = await this.getRecoveryRuntime();
    const createSessionStore = runtime.createSessionStore ?? runtime.createStore;

    if (!createSessionStore) {
      this.warnOnce(
        "create-session-store",
        "[pi-squad] Context recovery store unavailable; skipping recovery orchestration.",
      );
      return;
    }

    if (!assessment.triggerLevel) {
      return;
    }

    const stack = await this.getTeamStack();
    const stores = {
      root: await Promise.resolve(createSessionStore(stack.root.squadPath)),
      local: stack.isSingleTeam ? undefined : await Promise.resolve(createSessionStore(stack.local.squadPath)),
    };

    try {
      if (typeof runtime.RecoveryOrchestrator === "function") {
        await this.invokeRecovery(
          new runtime.RecoveryOrchestrator(stores),
          assessment,
          content,
          history,
          stack,
        );
        return;
      }

      const orchestrator = await this.createRecoveryOrchestrator(runtime, stores);
      if (orchestrator) {
        await this.invokeRecovery(orchestrator, assessment, content, history, stack);
        return;
      }
    } catch (error) {
      this.warnOnce(
        "recovery-failed",
        `[pi-squad] Context recovery failed; continuing with current prompt. ${String(error)}`,
      );
      return;
    }

    this.warnOnce(
      "recovery-runtime",
      "[pi-squad] RecoveryOrchestrator runtime unavailable; context recovery remains disabled.",
    );
  }

  private async invokeRecovery(
    orchestrator: RecoveryOrchestratorLike,
    assessment: ContextAssessment,
    content: string,
    history: readonly string[],
    stack: TeamStack,
  ): Promise<void> {
    if (!assessment.triggerLevel) {
      return;
    }

    if (orchestrator.recover.length >= 2) {
      await orchestrator.recover(assessment.triggerLevel, {
        budget: assessment.budget,
        teamRoot: stack.root.path,
        turnIndex: this.turnIndex,
        previousAttempts: orchestrator.getAttemptHistory?.() ?? [],
        coordinatorState: buildCoordinatorStateSnapshot(stack),
        estimator: this.monitor.estimator,
      });
      return;
    }

    await orchestrator.recover({
      currentPrompt: content,
      history: [...history],
      budget: assessment.budget,
      teamStack: stack,
    });
  }

  private async createRecoveryOrchestrator(
    runtime: RecoveryRuntime,
    stores: { root: unknown; local: unknown | undefined },
  ): Promise<RecoveryOrchestratorLike | null> {
    if (typeof runtime.createRecoveryOrchestrator === "function") {
      return runtime.createRecoveryOrchestrator(stores);
    }

    return null;
  }

  private async getRecoveryRuntime(): Promise<RecoveryRuntime> {
    if (!this.recoveryRuntimePromise) {
      this.recoveryRuntimePromise = loadRecoveryRuntime();
    }
    return this.recoveryRuntimePromise;
  }

  private warnOnce(key: string, message: string): void {
    if (this.warnedFeatures.has(key)) {
      return;
    }

    this.warnedFeatures.add(key);
    console.warn(message);
  }

  private resolveRouteContext(ctx: unknown): RouteContext {
    const record = asRecord(ctx);
    const cwd = asOptionalString(record?.cwd);
    const signal = record?.signal instanceof AbortSignal ? record.signal : undefined;
    const sessionId =
      asOptionalString(record?.sessionId) ??
      asOptionalString(
        asRecord(record?.sessionManager)?.activeSessionId ??
          asRecord(record?.sessionManager)?.sessionId,
      ) ??
      `session-${Date.now()}`;

    return { sessionId, cwd, signal };
  }

  private emitRouteLifecycle(stage: string, payload: Record<string, unknown>): void {
    try {
      this._pi.appendEntry("pi-squad.route.lifecycle", {
        stage,
        timestamp: new Date().toISOString(),
        ...payload,
      });
    } catch {
      // Ignore lifecycle emission failures.
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export async function initializeCoordinator(pi: ExtensionAPI): Promise<Coordinator> {
  const coordinator = new CoordinatorImpl(pi);

  pi.on("turn_end", async (_event, ctx) => {
    try {
      const usage = ctx.getContextUsage();
      if (usage) {
        console.log(
          `[pi-squad] turn_end: ${usage.percent?.toFixed(1) ?? "?"}% context used`,
        );
      }
    } catch {
      // Non-critical — swallow monitoring errors
    }
  });

  pi.on("session_start", async (event) => {
    const reason = (event as { reason?: string }).reason;
    if (reason === "startup" || reason === "resume") {
      const teamRoot = await coordinator.getTeamRoot();
      const [meta, version] = await Promise.all([readSquadMeta(), readSquadVersion(teamRoot)]);

      if (meta && version) {
        const result = checkCompatibility(version, meta);
        if (!result.compatible) {
          console.warn(`[pi-squad] Squad version warning: ${result.reason}`);
        }
      }

      // Issue 4: ensure knowledge dir exists and log any pending files
      try {
        const { initKnowledgeDir, scanKnowledgeDir } = await import("../context/ingestion/index.js");
        initKnowledgeDir(teamRoot);
        const pending = await scanKnowledgeDir(teamRoot);
        if (pending.length > 0) {
          console.log(
            `[pi-squad] ${pending.length} file(s) pending ingestion in .squad/knowledge/ — run /squad-ingest to index them`,
          );
        }
      } catch {
        // Non-critical — ingestion is opportunistic
      }
    }
  });

  pi.on("session_before_compact", async (_event, ctx) => {
    try {
      const usage = ctx.getContextUsage();
      console.log(
        `[pi-squad] session_before_compact: saving checkpoint at ${usage?.percent?.toFixed(1) ?? "?"}% context`,
      );
    } catch {
      // Non-critical
    }
  });

  return coordinator;
}
