/**
 * @module coordinator/spawn
 *
 * Type definitions for the exec()-based spawn bridge.
 *
 * Pi's ExtensionAPI has no native subagent primitive. The spawn bridge registers
 * a tool called `squad_dispatch` via `registerTool()` whose `execute()` uses
 * `exec()` to launch pi child processes. This is the coordinator's mechanism for
 * dispatching work to Squad agents.
 *
 * Design reference: docs/ARCHITECTURE.md §4 (agent spawn), B5 research findings.
 * Implementation: Batou — these are interfaces only.
 */
// ─── Spawn Error ──────────────────────────────────────────────────────────────
/**
 * Typed error thrown when a spawned agent process fails.
 * Wraps the exit code and stderr for structured error handling.
 */
export class SpawnError extends Error {
    agentId;
    exitCode;
    stderr;
    name = "SpawnError";
    constructor(message, 
    /** Agent that failed */
    agentId, 
    /** Process exit code (non-zero) */
    exitCode, 
    /** Captured stderr from the failed process */
    stderr) {
        super(message);
        this.agentId = agentId;
        this.exitCode = exitCode;
        this.stderr = stderr;
        Object.setPrototypeOf(this, SpawnError.prototype);
    }
}
const DEFAULT_SPAWN_TIMEOUT_MS = 120_000;
function buildSpawnRequest(directive, ctx) {
    return {
        agentId: directive.agentId,
        prompt: directive.prompt,
        systemPrompt: directive.systemPrompt ?? "",
        model: directive.model,
        timeout: directive.timeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS,
        sessionId: ctx.sessionId,
    };
}
function buildSpawnPrompt(req) {
    const systemSection = req.systemPrompt.trim();
    if (systemSection.length === 0) {
        return req.prompt;
    }
    return `${systemSection}\n\n---\n\n${req.prompt}`;
}
function hasExecApi(pi) {
    return Boolean(pi && typeof pi.exec === "function");
}
export async function spawnSquadAgent(directive, ctx) {
    const logger = ctx.logger ?? console;
    const request = buildSpawnRequest(directive, {
        sessionId: ctx.sessionId,
        pi: "pi" in ctx ? ctx.pi : undefined,
        cwd: ctx.cwd,
        signal: ctx.signal,
        logger,
    });
    const piCandidate = "pi" in ctx ? ctx.pi : undefined;
    if (!hasExecApi(piCandidate)) {
        logger.warn(`[pi-squad] Spawn API unavailable; skipped spawn for ${request.agentId}.`);
        return {
            kind: "noop",
            request,
            reason: "Pi ExtensionAPI exec() is unavailable in this runtime",
        };
    }
    const pi = piCandidate;
    const spawnedPrompt = buildSpawnPrompt(request);
    const startedAt = Date.now();
    const execResult = await pi.exec("pi", ["-p", spawnedPrompt], {
        cwd: ctx.cwd,
        timeout: request.timeout,
        signal: ctx.signal,
    });
    const duration = Date.now() - startedAt;
    const result = {
        agentId: request.agentId,
        output: execResult.stdout,
        exitCode: execResult.code,
        duration,
        error: execResult.code === 0 ? undefined : execResult.stderr || "spawned process exited non-zero",
    };
    if (execResult.code !== 0) {
        logger.warn(`[pi-squad] Spawned agent ${request.agentId} exited with code ${execResult.code}.`);
    }
    return {
        kind: "spawned",
        request,
        result,
    };
}
//# sourceMappingURL=spawn.js.map