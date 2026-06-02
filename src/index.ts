/**
 * @module index
 * Extension entry point — wires the Squad coordinator into the Pi CLI.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildSystemPrompt } from "./coordinator/system-prompt.js";
import { initializeCoordinator } from "./coordinator/coordinator.js";

export default async function (pi: ExtensionAPI): Promise<void> {
  const coordinator = await initializeCoordinator(pi);

  pi.on("before_agent_start", async (event, _ctx) => {
    const coordinatorPrompt = await coordinator.getSystemPrompt();
    const systemPrompt = buildSystemPrompt(event.systemPrompt, coordinatorPrompt);

    await coordinator.assessContext(systemPrompt);

    return {
      systemPrompt,
    };
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

