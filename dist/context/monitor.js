/**
 * @module context/monitor
 * Context window monitoring for the Squad coordinator.
 *
 * The ContextMonitor hooks into Pi's `before_agent_start` event to measure
 * context utilization at each turn. It emits typed pressure events and triggers
 * recovery when thresholds are crossed.
 *
 * Design principles:
 * - Non-blocking by default: monitoring is passive observation until thresholds hit
 * - Pi-agnostic measurement: works with native token counts OR character approximation
 * - Event-driven: consumers subscribe to typed pressure events
 * - Deterministic: same state always produces same pressure classification
 */
import { ContextPressureLevel } from "./types.js";
const WARNING_THRESHOLD = 70;
const CRITICAL_THRESHOLD = 90;
const OVERFLOW_THRESHOLD = 100;
const CHARS_PER_TOKEN = 4;
const PRESSURE_ORDER = {
    [ContextPressureLevel.NOMINAL]: 0,
    [ContextPressureLevel.WARNING]: 1,
    [ContextPressureLevel.CRITICAL]: 2,
    [ContextPressureLevel.OVERFLOW]: 3,
};
export class CharApproxTokenEstimator {
    method = "char-approx";
    charsPerToken;
    constructor(charsPerToken = CHARS_PER_TOKEN) {
        this.charsPerToken = charsPerToken;
    }
    estimate(text) {
        return Math.ceil(text.length / this.charsPerToken);
    }
}
;
export class SimpleContextMonitor {
    budget;
    handlers = new Map();
    lastAssessment = null;
    estimator;
    constructor(budget, estimator = new CharApproxTokenEstimator()) {
        this.budget = budget;
        this.estimator = estimator;
        for (const level of Object.values(ContextPressureLevel)) {
            this.handlers.set(level, []);
        }
    }
    /** Measure token count of text (char-approx: text.length / 4) */
    measure(text) {
        return this.estimator.estimate(text);
    }
    /** Classify pressure level based on % of budget used */
    classify(used) {
        const utilizationPercent = this.budget.total > 0 ? (used / this.budget.total) * 100 : 0;
        if (utilizationPercent >= OVERFLOW_THRESHOLD) {
            return ContextPressureLevel.OVERFLOW;
        }
        if (utilizationPercent >= CRITICAL_THRESHOLD) {
            return ContextPressureLevel.CRITICAL;
        }
        if (utilizationPercent >= WARNING_THRESHOLD) {
            return ContextPressureLevel.WARNING;
        }
        return ContextPressureLevel.NOMINAL;
    }
    /** Register handler for a pressure level */
    on(level, handler) {
        const handlers = this.handlers.get(level);
        if (handlers) {
            handlers.push(handler);
            return;
        }
        this.handlers.set(level, [handler]);
    }
    /** Assess current context, emit events if threshold crossed */
    assess(content, history = []) {
        const historyTokens = history.reduce((total, entry) => total + this.measure(entry), 0);
        const used = this.measure(content) + historyTokens;
        const pressureLevel = this.classify(used);
        const utilizationPercent = this.budget.total > 0 ? (used / this.budget.total) * 100 : 0;
        const nextBudget = {
            ...this.budget,
            used,
            available: Math.max(this.budget.total - used, 0),
            pressureLevel,
            utilizationPercent,
            measuredAt: new Date().toISOString(),
        };
        const assessment = {
            budget: nextBudget,
            recoveryNeeded: pressureLevel !== ContextPressureLevel.NOMINAL,
            triggerLevel: pressureLevel === ContextPressureLevel.NOMINAL ? null : pressureLevel,
        };
        const previousLevel = this.lastAssessment?.budget.pressureLevel ?? this.budget.pressureLevel;
        if (PRESSURE_ORDER[pressureLevel] >= PRESSURE_ORDER[ContextPressureLevel.WARNING] &&
            pressureLevel !== previousLevel) {
            for (const handler of this.handlers.get(pressureLevel) ?? []) {
                handler(assessment);
            }
        }
        this.lastAssessment = assessment;
        return assessment;
    }
}
;
//# sourceMappingURL=monitor.js.map