/**
 * @module context/types
 * Shared types for the context monitoring and recovery subsystem.
 *
 * Design invariants:
 * - All token estimates are approximate (Pi may not expose raw counts)
 * - Pressure levels form an ordered enum: NOMINAL < WARNING < CRITICAL < OVERFLOW
 * - Recovery is idempotent — running a strategy twice must be safe
 * - `.squad/` state is never destructively modified; checkpoints are additive
 */
// ─── Pressure Levels ──────────────────────────────────────────────────────────
/**
 * Ordered pressure levels representing context window utilization.
 * Each level triggers progressively more aggressive recovery strategies.
 */
export var ContextPressureLevel;
(function (ContextPressureLevel) {
    /** Context usage is within normal operating bounds (< 70%) */
    ContextPressureLevel["NOMINAL"] = "NOMINAL";
    /** Context usage is elevated; begin passive preparation (70–89%) */
    ContextPressureLevel["WARNING"] = "WARNING";
    /** Context usage is dangerously high; active recovery required (90–99%) */
    ContextPressureLevel["CRITICAL"] = "CRITICAL";
    /** Context has exceeded capacity; immediate intervention required (≥ 100%) */
    ContextPressureLevel["OVERFLOW"] = "OVERFLOW";
})(ContextPressureLevel || (ContextPressureLevel = {}));
// ─── Error Types ──────────────────────────────────────────────────────────────
/**
 * Thrown when context overflow cannot be recovered from.
 * This is a typed, explicit failure — NOT silent degradation.
 * The coordinator must surface this to Pi/user for acknowledgement.
 */
export class ContextOverflowError extends Error {
    budget;
    attempts;
    turnIndex;
    name = "ContextOverflowError";
    constructor(message, 
    /** Budget at the time of failure */
    budget, 
    /** Recovery attempts that were tried before giving up */
    attempts, 
    /** Turn index where the overflow was detected */
    turnIndex) {
        super(message);
        this.budget = budget;
        this.attempts = attempts;
        this.turnIndex = turnIndex;
        Object.setPrototypeOf(this, ContextOverflowError.prototype);
    }
}
/**
 * Thrown when a checkpoint cannot be created (e.g., disk write failure).
 * Recovery can still proceed with other strategies.
 */
export class CheckpointError extends Error {
    targetPath;
    cause;
    name = "CheckpointError";
    constructor(message, 
    /** The path that was being written when the error occurred */
    targetPath, cause) {
        super(message);
        this.targetPath = targetPath;
        this.cause = cause;
        Object.setPrototypeOf(this, CheckpointError.prototype);
    }
}
/**
 * Thrown when context monitoring detects an invalid configuration.
 */
export class ContextConfigError extends Error {
    field;
    value;
    name = "ContextConfigError";
    constructor(message, 
    /** Which config field is invalid */
    field, 
    /** The invalid value that was provided */
    value) {
        super(message);
        this.field = field;
        this.value = value;
        Object.setPrototypeOf(this, ContextConfigError.prototype);
    }
}
//# sourceMappingURL=types.js.map