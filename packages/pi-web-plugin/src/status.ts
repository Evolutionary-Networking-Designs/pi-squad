import type { WorkspaceLabelContribution, WorkspaceLabelContext } from "@jmfederico/pi-web/plugin-api";
import { createSquadReader, type LatestActivity } from "./squad-reader.js";
import { escapeHtml, listWorkspaceDirectory, readWorkspaceText, requestHostRender } from "./utils.js";

const SQUAD_ROOT = ".squad";
const DEFAULT_STATUS = "Squad ready";
const MAX_LABEL_LENGTH = 40;
const STATUS_REFRESH_TTL_MS = 30_000;
const ACTIVE_WINDOW_MS = 5 * 60_000;

type StatusPhase = "loading" | "ready";

interface StatusState {
  phase: StatusPhase;
  text: string;
  lastLoadedAt?: number;
  request?: Promise<void>;
}

interface BrowserWorkspaceLabelContext extends WorkspaceLabelContext {
  host?: {
    requestRender?: () => void;
  };
}

export function createSquadStatusLabel(): WorkspaceLabelContribution {
  const cache = new Map<string, StatusState>();

  return {
    id: "workspace.status",
    order: 20,
    items: (context) => {
      const state = ensureStatusState(cache, context as BrowserWorkspaceLabelContext);
      const compactText = compact(state.text);
      return [{
        type: "text",
        text: escapeHtml(compactText),
        title: escapeHtml(state.text),
      }];
    },
  };
}

function ensureStatusState(cache: Map<string, StatusState>, context: BrowserWorkspaceLabelContext): StatusState {
  const key = workspaceKey(context);
  let state = cache.get(key);
  if (state === undefined) {
    state = { phase: "loading", text: DEFAULT_STATUS };
    cache.set(key, state);
  }

  if (state.request === undefined && shouldRefresh(state)) {
    state.request = loadStatusState(context, state).finally(() => {
      state!.request = undefined;
    });
  }

  return state;
}

function shouldRefresh(state: StatusState): boolean {
  return state.lastLoadedAt === undefined || Date.now() - state.lastLoadedAt >= STATUS_REFRESH_TTL_MS;
}

async function loadStatusState(context: BrowserWorkspaceLabelContext, state: StatusState): Promise<void> {
  const reader = createSquadReader(
    (filePath) => readWorkspaceText(context.workspace, filePath),
    (directoryPath) => listWorkspaceDirectory(context.workspace, directoryPath),
  );

  const [lastDecision, latestActivity] = await Promise.all([
    reader.readLastDecision(SQUAD_ROOT),
    reader.readLatestActivity(SQUAD_ROOT),
  ]);

  state.text = summarizeStatus(latestActivity, lastDecision);
  state.phase = "ready";
  state.lastLoadedAt = Date.now();
  requestHostRender(context.host);
}

function summarizeStatus(latestActivity: LatestActivity | null, lastDecision: string | null): string {
  if (latestActivity?.modifiedAt !== undefined) {
    const modifiedAt = Date.parse(latestActivity.modifiedAt);
    if (!Number.isNaN(modifiedAt) && Date.now() - modifiedAt <= ACTIVE_WINDOW_MS) {
      return `🔄 ${latestActivity.agentName} working`;
    }
  }

  return lastDecision ?? DEFAULT_STATUS;
}

function compact(text: string): string {
  if (text.length <= MAX_LABEL_LENGTH) return text;
  return `${text.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…`;
}

function workspaceKey(context: WorkspaceLabelContext): string {
  return `${context.workspace.projectId}:${context.workspace.id}`;
}
