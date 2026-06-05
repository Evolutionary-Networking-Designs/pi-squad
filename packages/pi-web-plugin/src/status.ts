import type { WorkspaceLabelContribution, WorkspaceLabelContext } from "@jmfederico/pi-web/plugin-api";
import { createSquadReader } from "./squad-reader.js";
import { escapeHtml } from "./utils.js";

const SQUAD_ROOT = ".squad";
const DEFAULT_STATUS = "Squad ready";
const MAX_LABEL_LENGTH = 40;

type StatusPhase = "loading" | "ready";

interface StatusState {
  phase: StatusPhase;
  text: string;
  request?: Promise<void>;
}

interface BrowserWorkspaceLabelContext extends WorkspaceLabelContext {
  machine: { id: string };
  files: {
    readFile(path: string): Promise<{ binary?: boolean; content?: unknown }>;
  };
  host: {
    requestRender(): void;
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
  const key = `${context.machine.id}:${context.workspace.id}`;
  let state = cache.get(key);
  if (state === undefined) {
    state = { phase: "loading", text: DEFAULT_STATUS };
    cache.set(key, state);
  }

  if (state.request === undefined) {
    state.request = loadStatusState(context, state).finally(() => {
      state!.request = undefined;
    });
  }

  return state;
}

async function loadStatusState(context: BrowserWorkspaceLabelContext, state: StatusState): Promise<void> {
  const reader = createSquadReader(async (filePath) => {
    try {
      const file = await context.files.readFile(filePath);
      if (file.binary || typeof file.content !== "string") return null;
      return file.content;
    } catch {
      return null;
    }
  });

  state.text = await reader.readLastDecision(SQUAD_ROOT) ?? DEFAULT_STATUS;
  state.phase = "ready";
  context.host.requestRender();
}

function compact(text: string): string {
  if (text.length <= MAX_LABEL_LENGTH) return text;
  return `${text.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…`;
}
