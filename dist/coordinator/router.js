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
function escapeRegExp(value) {
    return value.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
}
function globToRegExp(pattern) {
    const escaped = escapeRegExp(pattern)
        .replace(/\*\*/gu, ".*")
        .replace(/\*/gu, "[^/]*");
    return new RegExp(`^${escaped}$`, "i");
}
function matchesPattern(pattern, signal) {
    return pattern instanceof RegExp
        ? pattern.test(signal)
        : signal.toLowerCase().includes(pattern.toLowerCase());
}
function matchesConditions(rule, context) {
    const { conditions } = rule;
    if (!conditions) {
        return true;
    }
    if (conditions.labels && conditions.labels.length > 0) {
        const labels = new Set((context?.labels ?? []).map((label) => label.toLowerCase()));
        if (!conditions.labels.every((label) => labels.has(label.toLowerCase()))) {
            return false;
        }
    }
    if (conditions.filePatterns && conditions.filePatterns.length > 0) {
        const filePaths = context?.filePaths ?? [];
        const matchesFilePattern = conditions.filePatterns.every((pattern) => filePaths.some((filePath) => globToRegExp(pattern).test(filePath)));
        if (!matchesFilePattern) {
            return false;
        }
    }
    if (conditions.custom) {
        return Boolean(context?.custom?.[conditions.custom]);
    }
    return true;
}
export function routeLocal(table, signal, context) {
    for (const rule of table.rules) {
        if (!matchesPattern(rule.pattern, signal) || !matchesConditions(rule, context)) {
            continue;
        }
        const agent = table.members.get(rule.agentId);
        if (!agent) {
            continue;
        }
        return {
            agent,
            matchedRule: rule,
            confidence: rule.pattern instanceof RegExp ? 1 : 0.9,
        };
    }
    return null;
}
export function routeWithEscalation(table, signal, context) {
    const local = routeLocal(table, signal, context);
    if (local) {
        return local;
    }
    if (table.parent) {
        const escalated = routeLocal(table.parent, signal, context);
        if (escalated) {
            return {
                ...escalated,
                escalatedTo: "root",
            };
        }
    }
    return null;
}
//# sourceMappingURL=router.js.map