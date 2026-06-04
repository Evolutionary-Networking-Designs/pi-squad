/**
 * @module squad/agent-role-map
 *
 * Pure mapping from Squad's typed AgentRole values to pi-subagents built-in agent names.
 * Computed once at load time; consumed by the spawn path when resolving piBuiltin.
 *
 * Design reference: docs/ARCHITECTURE.md §3 (casting / agent identity)
 */

// ─── AgentRole ────────────────────────────────────────────────────────────────

/**
 * All typed Squad agent roles.
 * Exhaustive — every value must have a case in agentRoleToBuiltin.
 */
export type AgentRole =
  | "lead"
  | "developer"
  | "tester"
  | "security"
  | "devops"
  | "designer"
  | "prompt-engineer"
  | "reviewer"
  | "scribe";

// ─── Role → Built-in Mapping ──────────────────────────────────────────────────

/**
 * Map a Squad AgentRole to the corresponding pi-subagents built-in agent name.
 *
 * Returns `null` for `scribe` — the scribe operates on the coordinator side
 * and is never spawned as a pi-subagents built-in.
 *
 * The switch has no `default` clause; TypeScript narrows `role` to `never` after
 * an exhaustive match, ensuring the compiler rejects any unhandled AgentRole value.
 */
export function agentRoleToBuiltin(role: AgentRole): string | null {
  switch (role) {
    case "lead":             return "planner";
    case "developer":        return "worker";
    case "tester":           return "reviewer";
    case "security":         return "reviewer";
    case "devops":           return "worker";
    case "designer":         return "worker";
    case "prompt-engineer":  return "worker";
    case "reviewer":         return "reviewer";
    case "scribe":           return null;
  }
  // After the exhaustive switch, TypeScript narrows `role` to `never`.
  // If a new AgentRole value is added without a matching case, this line
  // becomes reachable and the assignment errors at compile time.
  const _exhaustive: never = role;
  return _exhaustive;
}
