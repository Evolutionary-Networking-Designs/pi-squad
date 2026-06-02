/**
 * @module types
 *
 * Shared TypeScript interfaces for the pi-squad coordinator extension.
 * This is the top-level types module — re-exports from sub-modules are
 * collected here for external consumers (`@pi-squad/coordinator`).
 *
 * Design reference: docs/ARCHITECTURE.md §2 (coordinator init), §7.3 (hooks).
 */

import type { DispatchTable } from "./coordinator/router.js";

// ─── Context Usage ────────────────────────────────────────────────────────────

/**
 * Mirrors Pi's `ctx.getContextUsage()` return type.
 * Nullable fields reflect Pi's behavior post-compaction.
 */
export interface ContextUsageSnapshot {
  /** Tokens currently consumed (null when Pi cannot determine post-compaction) */
  readonly tokens: number | null;
  /** Total context window size in tokens */
  readonly contextWindow: number;
  /** Utilization percentage (0–100+) */
  readonly percent: number;
}

// ─── Team Configuration ───────────────────────────────────────────────────────

/**
 * Parsed team configuration from `.squad/team.md`.
 * Includes all metadata the coordinator needs for routing and display.
 */
export interface TeamConfig {
  /** Team display name (from team.md frontmatter) */
  readonly name: string;
  /** Agent IDs in the active roster */
  readonly agents: readonly string[];
  /** Default model tier for the team (agents can override individually) */
  readonly defaultTier?: "fast" | "balanced" | "capable";
  /** Skills enabled at the team level */
  readonly skills: readonly string[];
  /** Raw source hash for cache invalidation */
  readonly sourceHash: string;
}

// ─── Team Stack (Multi-Team Support) ─────────────────────────────────────────

/**
 * A single level in a multi-team stack — one .squad/ directory with its content.
 * Represents either the root governance team or a local package team.
 */
interface TeamLevel {
  /** Absolute path to the directory containing .squad/ */
  readonly path: string;
  /** Absolute path to .squad/ directory */
  readonly squadPath: string;
  /** Role of this level in the stack */
  readonly level: "root" | "local";
  /** Parsed team config (from team.md) */
  readonly config: TeamConfig;
  /** Absolute path to routing.md (may not exist) */
  readonly routingPath: string;
  /** Absolute path to decisions.md (may not exist) */
  readonly decisionsPath: string;
  /** Absolute path to decisions/inbox/ directory */
  readonly inboxPath: string;
}

/**
 * A resolved team stack — one or two team levels discovered by walking up from cwd.
 *
 * Single-team repos: local === root, isSingleTeam === true.
 * Multi-team repos: local is the nearest .squad/ (package level), root is the outermost.
 *
 * The isSingleTeam flag guarantees backward compat — all code paths that see
 * isSingleTeam: true behave identically to pre-multi-team behavior.
 */
interface TeamStack {
  /** The nearest .squad/ to cwd (package-level team, or root if single-team) */
  readonly local: TeamLevel;
  /** The repo-root .squad/ (governance team) */
  readonly root: TeamLevel;
  /** True when only one .squad/ was found (local === root by reference) */
  readonly isSingleTeam: boolean;
}

// ─── Coordinator Event (D5) ───────────────────────────────────────────────────

/**
 * Typed event emitted on the `before_agent_start` hook.
 * This is the primary input to the coordinator's main handler function.
 *
 * Constructed by the extension entry point from Pi's `BeforeAgentStartEvent`
 * enriched with Squad-specific state (team config, routing table).
 *
 * Lifecycle:
 * 1. Pi fires `before_agent_start`
 * 2. Extension builds `CoordinatorEvent` from Pi event + cached Squad state
 * 3. Coordinator handler receives this as its sole input
 * 4. Handler returns system prompt modifications back to Pi
 */
export interface CoordinatorEvent {
  /** Pi session identifier (stable across turns within a session) */
  readonly sessionId: string;
  /** Agent identifier (the coordinator's own ID in the system) */
  readonly agentId: string;
  /** ISO 8601 timestamp when this event was created */
  readonly timestamp: string;
  /**
   * Context usage snapshot from Pi's API.
   * Null when Pi cannot provide usage data (e.g., first turn before any response).
   */
  readonly contextUsage: ContextUsageSnapshot | null;
  /** Parsed team configuration from `.squad/team.md` */
  readonly teamConfig: TeamConfig;
  /** The current routing/dispatch table (parsed from team.md + routing.md) */
  readonly routingTable: DispatchTable;
  /** The raw user prompt text that triggered this agent turn */
  readonly userPrompt: string;
  /** The current system prompt (before coordinator modifications) */
  readonly systemPrompt: string;
  /** Turn index within the session (0-based, monotonically increasing) */
  readonly turnIndex: number;
}

// ─── Coordinator Result ───────────────────────────────────────────────────────

/**
 * Return type from the coordinator's main handler.
 * Maps to Pi's `BeforeAgentStartEventResult` shape.
 */
export interface CoordinatorResult {
  /** Modified system prompt (coordinator instructions prepended) */
  readonly systemPrompt?: string;
  /** Additional messages to inject into the conversation */
  readonly messages?: readonly CoordinatorMessage[];
}

/**
 * A message injected by the coordinator into the agent's conversation context.
 */
export interface CoordinatorMessage {
  /** Message role (typically "system" for coordinator injections) */
  readonly role: "system" | "user" | "assistant";
  /** Message content */
  readonly content: string;
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type {
  TeamMember,
  RoutingRule,
  DispatchTable,
  RouteResult,
  RoutingCondition,
  Router,
  RouterContext,
} from "./coordinator/router.js";

export type { TeamLevel, TeamStack };

export type {
  CoordinatorGuard,
  CoordinatorViolationType,
  AgentViolationContext,
} from "./coordinator/guard.js";

export { CoordinatorGuardError } from "./coordinator/guard.js";
