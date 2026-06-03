/**
 * @module index
 * Extension entry point — wires the Squad coordinator into the Pi CLI.
 */
import { buildSystemPrompt } from "./coordinator/system-prompt.js";
import { initializeCoordinator } from "./coordinator/coordinator.js";
import { initializeWorkMonitor } from "./ralph/work-monitor.js";
const HOOK_TIMEOUT_MS = 10_000;
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`[pi-squad] before_agent_start hook timed out after ${ms}ms`)), ms)),
    ]);
}
export default async function (pi) {
    const coordinator = await initializeCoordinator(pi);
    const ralph = await initializeWorkMonitor(pi, { coordinator });
    pi.on("before_agent_start", async (event, _ctx) => {
        try {
            const hookWork = async () => {
                const coordinatorPrompt = await coordinator.getSystemPrompt();
                const systemPrompt = buildSystemPrompt(event.systemPrompt, coordinatorPrompt);
                const assessment = await coordinator.assessContext(systemPrompt);
                await ralph.recordContextAssessment(assessment);
                return { systemPrompt };
            };
            return await withTimeout(hookWork(), HOOK_TIMEOUT_MS);
        }
        catch (error) {
            console.warn(`[pi-squad] before_agent_start hook failed; degrading to default system prompt. ${String(error)}`);
            return { systemPrompt: event.systemPrompt };
        }
    });
    pi.registerCommand("squad", {
        description: "Invoke Squad coordinator for team routing",
        handler: async (args, ctx) => {
            await coordinator.route(args, ctx);
        },
    });
    pi.registerCommand("squad-update", {
        description: "Sync Squad upstream and reload",
        handler: async (_args, ctx) => {
            console.log("[pi-squad] Running squad-update...");
            // stub — full impl in future sprint
            await ctx.reload();
        },
    });
}
//# sourceMappingURL=index.js.map