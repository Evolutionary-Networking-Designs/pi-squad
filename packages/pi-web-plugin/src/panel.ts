import type { PluginActivationContext, WorkspacePanelContribution, WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { createSquadReader, type LatestActivity, type TeamMember } from "./squad-reader.js";
import { escapeHtml, listWorkspaceDirectory, readWorkspaceText, requestHostRender } from "./utils.js";

const SQUAD_ROOT = ".squad";
const PANEL_REFRESH_TTL_MS = 30_000;

type HtmlTemplateTag = PluginActivationContext["html"];
type SvgTemplateTag = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
type PanelStatus = "loading" | "ready" | "error";

interface PanelState {
  status: PanelStatus;
  roster: TeamMember[];
  focus: string | null;
  latestActivity: LatestActivity | null;
  decisionCount: number | null;
  lastLoadedAt?: number;
  request?: Promise<void>;
}

interface BrowserWorkspacePanelContext extends WorkspacePanelContext {
  host?: {
    requestRender?: () => void;
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
      const activityText = state.latestActivity === null
        ? null
        : `🔄 Last active: ${state.latestActivity.agentName} — ${state.latestActivity.task}`;

      return html`
        <section class="toolbar">
          <strong>Squad</strong>
          <button
            type="button"
            ?disabled=${state.request !== undefined}
            @click=${() => {
              void refreshPanelState(browserContext, state);
            }}
          >
            ${state.request === undefined ? "Refresh" : "Refreshing…"}
          </button>
        </section>
        <section class="viewer">
          <p><strong>Current focus</strong></p>
          <p class="muted">${escapedFocusText}</p>

          ${activityText === null ? "" : html`
            <p><strong>Activity</strong></p>
            <p class="muted">${escapeHtml(activityText)}</p>
          `}

          ${state.decisionCount === null ? "" : html`
            <p class="muted">${escapeHtml(`📋 ${state.decisionCount} team decisions`)}</p>
          `}

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
  const key = workspaceKey(context);
  let state = cache.get(key);
  if (state === undefined) {
    state = {
      status: "loading",
      roster: [],
      focus: null,
      latestActivity: null,
      decisionCount: null,
    };
    cache.set(key, state);
  }

  if (state.request === undefined && shouldRefresh(state)) {
    state.request = loadPanelState(context, state).finally(() => {
      state!.request = undefined;
    });
  }

  return state;
}

function shouldRefresh(state: PanelState): boolean {
  return state.lastLoadedAt === undefined || Date.now() - state.lastLoadedAt >= PANEL_REFRESH_TTL_MS;
}

function refreshPanelState(context: BrowserWorkspacePanelContext, state: PanelState): Promise<void> {
  if (state.request !== undefined) return state.request;
  state.status = "loading";
  requestHostRender(context.host);
  state.request = loadPanelState(context, state).finally(() => {
    state.request = undefined;
  });
  return state.request;
}

async function loadPanelState(context: BrowserWorkspacePanelContext, state: PanelState): Promise<void> {
  const reader = createSquadReader(
    (filePath) => readWorkspaceText(context.workspace, filePath),
    (directoryPath) => listWorkspaceDirectory(context.workspace, directoryPath),
  );

  try {
    const [roster, focus, latestActivity, decisionCount] = await Promise.all([
      reader.readTeamRoster(SQUAD_ROOT),
      reader.readCurrentFocus(SQUAD_ROOT),
      reader.readLatestActivity(SQUAD_ROOT),
      reader.readDecisionCount(SQUAD_ROOT),
    ]);
    state.roster = roster;
    state.focus = focus;
    state.latestActivity = latestActivity;
    state.decisionCount = decisionCount;
    state.status = "ready";
  } catch {
    state.roster = [];
    state.focus = null;
    state.latestActivity = null;
    state.decisionCount = null;
    state.status = "error";
  }

  state.lastLoadedAt = Date.now();
  requestHostRender(context.host);
}

function workspaceKey(context: WorkspacePanelContext): string {
  return `${context.workspace.projectId}:${context.workspace.id}`;
}
