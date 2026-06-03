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
import type { RouteDirective } from "./router.js";
/**
 * Discriminated union of coordinator policy violation types.
 */
export type CoordinatorViolationType = "DOMAIN_WORK_ATTEMPTED" | "INVALID_ROUTING" | "REVIEWER_LOCKOUT_VIOLATION" | "SPAWN_REQUIRED";
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
export declare class CoordinatorGuardError extends Error {
    /** The type of policy violation that occurred */
    readonly violation: CoordinatorViolationType;
    /** The action or operation that triggered the violation */
    readonly attemptedAction: string;
    /** Contextual information about the agent/coordinator state at violation time */
    readonly agentContext: AgentViolationContext;
    readonly name: "CoordinatorGuardError";
    constructor(message: string, 
    /** The type of policy violation that occurred */
    violation: CoordinatorViolationType, 
    /** The action or operation that triggered the violation */
    attemptedAction: string, 
    /** Contextual information about the agent/coordinator state at violation time */
    agentContext: AgentViolationContext);
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
export type GuardViolationCode = "UNKNOWN_DIRECTIVE_TYPE" | "MISSING_REQUIRED_FIELD" | "CIRCULAR_SPAWN_REFERENCE" | "SCHEMA_CONSTRAINT_VIOLATION";
export interface GuardViolation {
    readonly code: GuardViolationCode;
    readonly message: string;
    readonly directiveType: string;
    readonly field?: string;
}
type RouteDirectiveLike = {
    type: string;
} & Record<string, unknown>;
export type GuardCheckResult = {
    readonly ok: true;
    readonly directive: RouteDirective;
} | {
    readonly ok: false;
    readonly violation: GuardViolation;
};
export declare function truncateForLog(s: string, maxLen?: number): string;
export declare class GuardChecker {
    validate(directive: RouteDirectiveLike): GuardCheckResult;
}
export {};
//# sourceMappingURL=guard.d.ts.map