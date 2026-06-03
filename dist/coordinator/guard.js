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
    violation;
    attemptedAction;
    agentContext;
    name = "CoordinatorGuardError";
    constructor(message, 
    /** The type of policy violation that occurred */
    violation, 
    /** The action or operation that triggered the violation */
    attemptedAction, 
    /** Contextual information about the agent/coordinator state at violation time */
    agentContext) {
        super(message);
        this.violation = violation;
        this.attemptedAction = attemptedAction;
        this.agentContext = agentContext;
        Object.setPrototypeOf(this, CoordinatorGuardError.prototype);
    }
}
//# sourceMappingURL=guard.js.map