/**
 * @module coordinator/router
 *
 * Type definitions for the coordinator's routing subsystem.
 *
 * The router parses `team.md` and `routing.md` from `.squad/` into a typed
 * dispatch table, then matches incoming tasks to the best-fit agent using
 * pattern matching and priority ordering.
 *
 * Design reference: docs/ARCHITECTURE.md §2, §6.3 (graceful degradation),
 * §7.1 (custom agents).
 */
/**
 * A registered team member in the Squad roster.
 * Parsed from `.squad/team.md` agent entries.
 */
export interface TeamMember {
    /** Unique agent identifier (lowercase, matches directory name in .squad/agents/) */
    readonly id: string;
    /** Display name (e.g., "Motoko", "Batou") */
    readonly name: string;
    /** Agent's role description (e.g., "Lead", "Backend Engineer") */
    readonly role: string;
    /** Emoji identifier used in coordinator output (e.g., "🎯", "🔧") */
    readonly emoji: string;
    /** Optional model tier override for this agent (overrides team-level default) */
    readonly model?: string;
    /** Skill tags describing this agent's competencies */
    readonly skills: readonly string[];
}
/**
 * Optional conditions that must be met for a routing rule to activate.
 */
export interface RoutingCondition {
    /** File path glob patterns that must be present in the task context */
    readonly filePatterns?: readonly string[];
    /** Required labels (e.g., from GitHub issues) for this rule to match */
    readonly labels?: readonly string[];
    /** Custom predicate key (evaluated by the coordinator at runtime) */
    readonly custom?: string;
}
/**
 * A single routing rule mapping task patterns to agents.
 * Parsed from `.squad/routing.md` dispatch directives.
 */
export interface RoutingRule {
    /** Pattern to match against the task description or content */
    readonly pattern: RegExp | string;
    /** Target agent ID to route to when this rule matches */
    readonly agentId: string;
    /** Priority for rule ordering (higher = evaluated first, ties broken by source order) */
    readonly priority: number;
    /** Optional conditions that further constrain when this rule applies */
    readonly conditions?: RoutingCondition;
}
/**
 * The complete dispatch table combining team roster and routing rules.
 * Built at coordinator initialization from `.squad/team.md` + `.squad/routing.md`.
 *
 * This is the coordinator's primary lookup structure for agent dispatch.
 */
export interface DispatchTable {
    /** Agent roster indexed by agent ID */
    readonly members: ReadonlyMap<string, TeamMember>;
    /** Ordered routing rules (sorted by priority descending, then source order) */
    readonly rules: readonly RoutingRule[];
    /** ISO 8601 timestamp when this table was last parsed */
    readonly parsedAt: string;
    /** SHA or content hash of source files for cache invalidation */
    readonly sourceHash: string;
    /**
     * Optional parent dispatch table for cross-team escalation.
     * When set, the router will escalate to parent if no local rule matches.
     * Present only in multi-team repos; undefined in single-team (isSingleTeam: true).
     */
    readonly parent?: DispatchTable;
}
/**
 * The result of routing a task through the dispatch table.
 * Returned by the router's match function.
 */
export interface RouteResult {
    /** The matched agent to dispatch to */
    readonly agent: TeamMember;
    /** The routing rule that produced this match (undefined if fallback/direct) */
    readonly matchedRule: RoutingRule | undefined;
    /** Confidence score for the match (0.0 = fallback guess, 1.0 = exact pattern match) */
    readonly confidence: number;
    /**
     * If the route was resolved by escalating to a parent table, indicates which level.
     * undefined means the match was local (no escalation occurred).
     */
    readonly escalatedTo?: "root" | "sibling";
}
/**
 * The router resolves task descriptions to target agents.
 *
 * Implementation (not in this file) will:
 * 1. Parse `.squad/team.md` → TeamMember[]
 * 2. Parse `.squad/routing.md` → RoutingRule[]
 * 3. Build DispatchTable
 * 4. Match tasks via `route()`
 */
export interface Router {
    /** The current dispatch table (re-parseable on config change) */
    readonly table: DispatchTable;
    /**
     * Route a task description to the best-matching agent.
     * Returns null if no agent can be matched (coordinator should handle directly
     * or request clarification).
     *
     * @param task - The task description or user prompt to route
     * @param context - Optional additional context for condition evaluation
     */
    route(task: string, context?: RouterContext): RouteResult | null;
    /**
     * Reload the dispatch table from `.squad/` files.
     * Called on extension reload or when file changes are detected.
     */
    reload(): Promise<void>;
}
/**
 * Additional context passed to the router for condition evaluation.
 */
export interface RouterContext {
    /** File paths involved in the current task */
    readonly filePaths?: readonly string[];
    /** Labels from the issue/PR being worked on */
    readonly labels?: readonly string[];
    /** Custom context keys for condition predicates */
    readonly custom?: Readonly<Record<string, unknown>>;
}
export declare function routeLocal(table: DispatchTable, signal: string, context?: RouterContext): RouteResult | null;
export declare function routeWithEscalation(table: DispatchTable, signal: string, context?: RouterContext): RouteResult | null;
//# sourceMappingURL=router.d.ts.map