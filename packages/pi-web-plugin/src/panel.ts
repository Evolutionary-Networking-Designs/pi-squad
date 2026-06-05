import type { PluginActivationContext, WorkspacePanelContribution, WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { createSquadReader, type TeamMember } from "./squad-reader.js";
import { escapeHtml } from "./utils.js";

const SQUAD_ROOT = ".squad";

type HtmlTemplateTag = PluginActivationContext["html"];
type SvgTemplateTag = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
type PanelStatus = "loading" | "ready" | "error";

interface PanelState {
  status: PanelStatus;
  roster: TeamMember[];
  focus: string | null;
  request?: Promise<void>;
}

interface BrowserWorkspacePanelContext extends WorkspacePanelContext {
  machine: { id: string };
  files: {
    readFile(path: string): Promise<{ binary?: boolean; content?: unknown }>;
  };
  host: {
    requestRender(): void;
  };
}

export function createSquadWorkspacePanel(
  activation: { html: HtmlTemplateTag; svg: SvgTemplateTag },
): WorkspacePanelContribution {
  const { html, svg } = activation;
  const cache = new Map<string, PanelState>();

  const contribution = {
    id: "workspace.squad",
    title: "Squad",
    order: 920,
    icon: svg`
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>
    `,
    render: (context: WorkspacePanelContext) => {
      const browserContext = context as BrowserWorkspacePanelContext;
      const state = ensurePanelState(cache, browserContext);
      const focusText = state.status === "loading"
        ? "Loading Squad state…"
        : state.focus ?? "No current focus recorded.";
      const escapedFocusText = escapeHtml(focusText);

      return html`
        <section class="toolbar"><strong>Squad</strong></section>
        <section class="viewer">
          <p><strong>Current focus</strong></p>
          <p class="muted">${escapedFocusText}</p>

          <p><strong>Members</strong></p>
          ${state.roster.length === 0
            ? html`<p class="empty">No team roster available.</p>`
            : html`
                <ul>
                  ${state.roster.map((member) => {
                    const escapedName = escapeHtml(member.name);
                    const escapedRole = escapeHtml(member.role);
                    return html`
                      <li>
                        <strong>${escapedName}</strong>
                        <span class="muted"> — ${escapedRole}</span>
                      </li>
                    `;
                  })}
                </ul>
              `}
        </section>
      `;
    },
  };

  return contribution as WorkspacePanelContribution;
}

function ensurePanelState(cache: Map<string, PanelState>, context: BrowserWorkspacePanelContext): PanelState {
  const key = `${context.machine.id}:${context.workspace.id}`;
  let state = cache.get(key);
  if (state === undefined) {
    state = { status: "loading", roster: [], focus: null };
    cache.set(key, state);
  }

  if (state.request === undefined) {
    state.request = loadPanelState(context, state).finally(() => {
      state!.request = undefined;
    });
  }

  return state;
}

async function loadPanelState(context: BrowserWorkspacePanelContext, state: PanelState): Promise<void> {
  const reader = createSquadReader(async (filePath) => {
    try {
      const file = await context.files.readFile(filePath);
      if (file.binary || typeof file.content !== "string") return null;
      return file.content;
    } catch {
      return null;
    }
  });

  try {
    const [roster, focus] = await Promise.all([
      reader.readTeamRoster(SQUAD_ROOT),
      reader.readCurrentFocus(SQUAD_ROOT),
    ]);
    state.roster = roster;
    state.focus = focus;
    state.status = "ready";
  } catch {
    state.roster = [];
    state.focus = null;
    state.status = "error";
  }

  context.host.requestRender();
}
