import type { PiWebPlugin, PluginActivationContext } from "@jmfederico/pi-web/plugin-api";
import { createSquadCommand } from "./command.js";
import { createSquadWorkspacePanel } from "./panel.js";
import { createSquadStatusLabel } from "./status.js";

type SvgTemplateTag = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
type ActivationContextWithSvg = PluginActivationContext & { svg: SvgTemplateTag };

const plugin: PiWebPlugin = {
  apiVersion: 1,
  name: "pi-squad",
  activate: (context) => {
    const { html } = context;
    const { svg } = context as ActivationContextWithSvg;

    return {
      contributions: {
        actions: [createSquadCommand()],
        workspacePanels: [createSquadWorkspacePanel({ html, svg })],
        workspaceLabels: [createSquadStatusLabel()],
      },
    };
  },
};

export default plugin;
