/**
 * @module coordinator/guard
 *
 * TypeScript-enforced coordinator guardrails.
 *
 * The coordinator must NEVER do domain work inline — it routes to agents.
 * These guards throw typed errors when violations are detected, making
 * coordinator delegation rules runtime-enforced rather than soft guidance.
 *
 * Design reference: docs/ARCHITECTURE.md §8, decisions.md "TypeScript-enforced
 * coordinator guardrails" directive.
 */

import type { AgentSpawnDirective, KnownDirectiveType, RouteDirective } from "./router.js";

// ─── Violation Types ──────────────────────────────────────────────────────────

/**
 * Discriminated union of coordinator policy violation types.
 */
export type CoordinatorViolationType =
  | "DOMAIN_WORK_ATTEMPTED"
  | "INVALID_ROUTING"
  | "REVIEWER_LOCKOUT_VIOLATION"
  | "SPAWN_REQUIRED";

// ─── Error Class ──────────────────────────────────────────────────────────────

/**
 * Thrown when the coordinator violates its delegation policy.
 * This is a typed Error subclass with structured context for diagnostics.
 *
 * Violation semantics:
 * - `DOMAIN_WORK_ATTEMPTED`: Coordinator tried to do agent work inline
 *   instead of delegating to a team member.
 * - `INVALID_ROUTING`: Routing directive targets a non-existent agent ID.
 * - `REVIEWER_LOCKOUT_VIOLATION`: A locked-out author was re-admitted as
 *   the revision agent (violates reviewer protocol).
 * - `SPAWN_REQUIRED`: An action requires spawning a sub-agent, but the
 *   coordinator attempted to handle it inline.
 */
export class CoordinatorGuardError extends Error {
  public readonly name = "CoordinatorGuardError" as const;

  constructor(
    message: string,
    /** The type of policy violation that occurred */
    public readonly violation: CoordinatorViolationType,
    /** The action or operation that triggered the violation */
    public readonly attemptedAction: string,
    /** Contextual information about the agent/coordinator state at violation time */
    public readonly agentContext: AgentViolationContext,
  ) {
    super(message);
    Object.setPrototypeOf(this, CoordinatorGuardError.prototype);
  }
}

/**
 * Contextual information captured at the time of a coordinator violation.
 * Enables diagnostics and audit trail without exposing full internal state.
 */
export interface AgentViolationContext {
  /** The coordinator session ID where the violation occurred */
  readonly sessionId: string;
  /** ISO 8601 timestamp of the violation */
  readonly timestamp: string;
  /** The agent ID involved (e.g., target of invalid route, locked-out author) */
  readonly agentId?: string;
  /** The artifact ID involved (for reviewer lockout violations) */
  readonly artifactId?: string;
  /** The routing rule that was being evaluated (if applicable) */
  readonly routingRule?: string;
}

// ─── Guard Interface ──────────────────────────────────────────────────────────

/**
 * Runtime policy enforcement for the coordinator.
 *
 * Each method is an assertion — it returns void on success and throws
 * `CoordinatorGuardError` on violation. This makes policy enforcement
 * compile-time visible (callers must handle or propagate the error).
 *
 * Usage pattern:
 * ```typescript
 * guard.assertCanRoute(targetAgentId);     // throws if agent doesn't exist
 * guard.assertNotLocked(agentId, prId);    // throws if author is locked out
 * guard.assertRequiresSpawn(action);       // throws if action needs spawn
 * ```
 */
export interface CoordinatorGuard {
  /**
   * Assert that a routing target is valid (agent exists in the dispatch table).
   * Throws `INVALID_ROUTING` if the agent ID is not in the active roster.
   *
   * @param agentId - The target agent ID to validate
   * @throws CoordinatorGuardError with violation type `INVALID_ROUTING`
   */
  assertCanRoute(agentId: string): void;

  /**
   * Assert that an agent is not locked out from revising a specific artifact.
   * Implements the reviewer protocol: original authors cannot be re-admitted
   * as revision agents for their own rejected work.
   *
   * @param agentId - The agent being considered for revision work
   * @param artifactId - The artifact (PR, file, etc.) under review
   * @throws CoordinatorGuardError with violation type `REVIEWER_LOCKOUT_VIOLATION`
   */
  assertNotLocked(agentId: string, artifactId: string): void;

  /**
   * Assert that an action requires spawning a sub-agent and cannot be done inline.
   * Prevents the coordinator from performing domain work directly.
   *
   * This is the primary guard against the coordinator "doing the work itself"
   * rather than delegating. Any action that modifies code, writes files, or
   * performs substantive domain work must go through spawn.
   *
   * @param action - Description of the action being attempted
   * @throws CoordinatorGuardError with violation type `SPAWN_REQUIRED` or
   *         `DOMAIN_WORK_ATTEMPTED` depending on the nature of the action
   */
  assertRequiresSpawn(action: string): void;
}

// ─── Runtime Directive Guard ───────────────────────────────────────────────────

const KNOWN_DIRECTIVE_TYPES = new Set<KnownDirectiveType>([
  "agent_spawn",
  "squad_update",
  "direct_response",
  "unknown",
]);

export type GuardViolationCode =
  | "UNKNOWN_DIRECTIVE_TYPE"
  | "MISSING_REQUIRED_FIELD"
  | "CIRCULAR_SPAWN_REFERENCE"
  | "SCHEMA_CONSTRAINT_VIOLATION";

export interface GuardViolation {
  readonly code: GuardViolationCode;
  readonly message: string;
  readonly directiveType: string;
  readonly field?: string;
}

type RouteDirectiveLike = { type: string } & Record<string, unknown>;

export type GuardCheckResult =
  | { readonly ok: true; readonly directive: RouteDirective }
  | { readonly ok: false; readonly violation: GuardViolation };

function isKnownDirectiveType(type: string): type is KnownDirectiveType {
  return KNOWN_DIRECTIVE_TYPES.has(type as KnownDirectiveType);
}

function hasRequiredText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function truncateForLog(s: string, maxLen = 80): string {
  return s.slice(0, maxLen) + (s.length > maxLen ? "…[truncated]" : "");
}

const AGENT_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,49}$/;
const MAX_AGENT_SPAWN_TEXT_LENGTH = 32_000;
const MAX_MESSAGE_TEXT_LENGTH = 8_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;
const AGENT_SPAWN_ALLOWED_FIELDS = new Set([
  "type",
  "agentId",
  "prompt",
  "systemPrompt",
  "model",
  "timeoutMs",
  "parentAgentId",
  "spawnPath",
]);

function detectCircularSpawnReference(directive: AgentSpawnDirective): boolean {
  if (directive.parentAgentId && directive.parentAgentId === directive.agentId) {
    return true;
  }

  const path = directive.spawnPath ?? [];
  if (path.length === 0) {
    return false;
  }

  const seen = new Set<string>();
  for (const node of path) {
    if (seen.has(node)) {
      return true;
    }
    seen.add(node);
  }

  return seen.has(directive.agentId);
}

export class GuardChecker {
  validate(directive: RouteDirectiveLike): GuardCheckResult {
    if (!isKnownDirectiveType(directive.type)) {
      return {
        ok: false,
        violation: {
          code: "UNKNOWN_DIRECTIVE_TYPE",
          message: `Unknown directive type "${directive.type}"`,
          directiveType: directive.type,
        },
      };
    }

    if (directive.type === "unknown") {
      return { ok: true, directive: { type: "unknown", payload: directive } };
    }

    if (directive.type === "agent_spawn") {
      if (!hasRequiredText(directive.agentId)) {
        return {
          ok: false,
          violation: {
            code: "MISSING_REQUIRED_FIELD",
            message: "agent_spawn requires a non-empty agentId",
            directiveType: directive.type,
            field: "agentId",
          },
        };
      }

      if (!hasRequiredText(directive.prompt)) {
        return {
          ok: false,
          violation: {
            code: "MISSING_REQUIRED_FIELD",
            message: "agent_spawn requires a non-empty prompt",
            directiveType: directive.type,
            field: "prompt",
          },
        };
      }

      // Mitigates directive spoofing that targets unexpected IDs or path-like agent identifiers.
      if (!AGENT_ID_PATTERN.test(directive.agentId)) {
        return {
          ok: false,
          violation: {
            code: "SCHEMA_CONSTRAINT_VIOLATION",
            message: `agent_spawn agentId fails allowlist: "${truncateForLog(directive.agentId)}"`,
            directiveType: directive.type,
            field: "agentId",
          },
        };
      }

      // Mitigates prompt-amplification payloads that try to overwhelm child agent context.
      if (directive.prompt.length > MAX_AGENT_SPAWN_TEXT_LENGTH) {
        return {
          ok: false,
          violation: {
            code: "SCHEMA_CONSTRAINT_VIOLATION",
            message: `agent_spawn prompt exceeds ${MAX_AGENT_SPAWN_TEXT_LENGTH} characters (${directive.prompt.length})`,
            directiveType: directive.type,
            field: "prompt",
          },
        };
      }

      // Mitigates oversized system prompt injection used to persist adversarial control text.
      if (
        typeof directive.systemPrompt === "string" &&
        directive.systemPrompt.length > MAX_AGENT_SPAWN_TEXT_LENGTH
      ) {
        return {
          ok: false,
          violation: {
            code: "SCHEMA_CONSTRAINT_VIOLATION",
            message: `agent_spawn systemPrompt exceeds ${MAX_AGENT_SPAWN_TEXT_LENGTH} characters (${directive.systemPrompt.length})`,
            directiveType: directive.type,
            field: "systemPrompt",
          },
        };
      }

      // Mitigates runaway/liveness abuse by bounding timeouts to sane finite integer values.
      if (
        Object.prototype.hasOwnProperty.call(directive, "timeoutMs") &&
        directive.timeoutMs !== undefined
      ) {
        const timeoutMs = directive.timeoutMs;
        if (
          typeof timeoutMs !== "number" ||
          !Number.isFinite(timeoutMs) ||
          !Number.isInteger(timeoutMs) ||
          timeoutMs < MIN_TIMEOUT_MS ||
          timeoutMs > MAX_TIMEOUT_MS
        ) {
          return {
            ok: false,
            violation: {
              code: "SCHEMA_CONSTRAINT_VIOLATION",
              message: `agent_spawn timeoutMs must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}; got "${truncateForLog(String(timeoutMs))}"`,
              directiveType: directive.type,
              field: "timeoutMs",
            },
          };
        }
      }

      // Mitigates schema smuggling/log confusion by warning and ignoring unknown fields.
      const extraFields = Object.keys(directive).filter(
        (field) => !AGENT_SPAWN_ALLOWED_FIELDS.has(field),
      );
      if (extraFields.length > 0) {
        console.warn(
          `[pi-squad] agent_spawn contains unknown fields (ignored): ${truncateForLog(extraFields.join(", "), 200)}`,
        );
      }

      const typedDirective: AgentSpawnDirective = {
        type: "agent_spawn",
        agentId: directive.agentId,
        prompt: directive.prompt,
        systemPrompt: hasRequiredText(directive.systemPrompt) ? directive.systemPrompt : undefined,
        model:
          directive.model === "fast" ||
          directive.model === "balanced" ||
          directive.model === "capable"
            ? directive.model
            : undefined,
        timeoutMs: typeof directive.timeoutMs === "number" ? directive.timeoutMs : undefined,
        parentAgentId: hasRequiredText(directive.parentAgentId)
          ? directive.parentAgentId
          : undefined,
        spawnPath: Array.isArray(directive.spawnPath)
          ? directive.spawnPath.filter((value): value is string => typeof value === "string")
          : undefined,
      };

      if (detectCircularSpawnReference(typedDirective)) {
        return {
          ok: false,
          violation: {
            code: "CIRCULAR_SPAWN_REFERENCE",
            message: "agent_spawn contains a circular spawn reference",
            directiveType: directive.type,
          },
        };
      }

      return { ok: true, directive: typedDirective };
    }

    if (directive.type === "squad_update") {
      if (!hasRequiredText(directive.message)) {
        return {
          ok: false,
          violation: {
            code: "MISSING_REQUIRED_FIELD",
            message: "squad_update requires a non-empty message",
            directiveType: directive.type,
            field: "message",
          },
        };
      }

      // Mitigates log-poisoning and memory-bloat payloads in coordinator status channels.
      if (directive.message.length > MAX_MESSAGE_TEXT_LENGTH) {
        return {
          ok: false,
          violation: {
            code: "SCHEMA_CONSTRAINT_VIOLATION",
            message: `squad_update message exceeds ${MAX_MESSAGE_TEXT_LENGTH} characters (${directive.message.length})`,
            directiveType: directive.type,
            field: "message",
          },
        };
      }

      // Mitigates oversized metadata payloads used for persistence or downstream prompt shaping.
      if (
        typeof directive.details === "string" &&
        directive.details.length > MAX_MESSAGE_TEXT_LENGTH
      ) {
        return {
          ok: false,
          violation: {
            code: "SCHEMA_CONSTRAINT_VIOLATION",
            message: `squad_update details exceeds ${MAX_MESSAGE_TEXT_LENGTH} characters (${directive.details.length})`,
            directiveType: directive.type,
            field: "details",
          },
        };
      }

      return {
        ok: true,
        directive: {
          type: "squad_update",
          message: directive.message,
          details: hasRequiredText(directive.details) ? directive.details : undefined,
        },
      };
    }

    if (!hasRequiredText(directive.message)) {
      return {
        ok: false,
        violation: {
          code: "MISSING_REQUIRED_FIELD",
          message: "direct_response requires a non-empty message",
          directiveType: directive.type,
          field: "message",
        },
      };
    }

    // Mitigates oversized direct-response payloads that can poison logs and coordinator state.
    if (directive.message.length > MAX_MESSAGE_TEXT_LENGTH) {
      return {
        ok: false,
        violation: {
          code: "SCHEMA_CONSTRAINT_VIOLATION",
          message: `direct_response message exceeds ${MAX_MESSAGE_TEXT_LENGTH} characters (${directive.message.length})`,
          directiveType: directive.type,
          field: "message",
        },
      };
    }

    return {
      ok: true,
      directive: { type: "direct_response", message: directive.message },
    };
  }
}
