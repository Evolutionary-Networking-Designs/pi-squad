const DEFAULT_SQUAD_ROOT = ".squad";
const DEFAULT_STATUS = "Squad ready";
const MAX_FOCUS_LENGTH = 200;
const MAX_STATUS_LENGTH = 120;
const MAX_ACTIVITY_LENGTH = 120;
const MAX_LABEL_LENGTH = 40;
const MAX_DECISION_LINES = 80;
const PANEL_REFRESH_TTL_MS = 30_000;
const STATUS_REFRESH_TTL_MS = 30_000;
const ACTIVE_WINDOW_MS = 5 * 60_000;
const SQUAD_COMMAND = "/squad";

const panelCache = new Map();
const statusCache = new Map();

const plugin = {
  apiVersion: 1,
  name: "pi-squad",
  activate: ({ html, svg }) => ({
    contributions: {
      actions: [createSquadCommand()],
      workspacePanels: [createSquadWorkspacePanel(html, svg)],
      workspaceLabels: [createSquadStatusLabel()],
    },
  }),
};

export default plugin;

function createSquadWorkspacePanel(html, svg) {
  return {
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
    render: (context) => {
      const state = ensurePanelState(context);
      const focusText = state.status === "loading"
        ? "Loading Squad state…"
        : state.focus ?? "No current focus recorded.";
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
              void refreshPanelState(context, state);
            }}
          >
            ${state.request === undefined ? "Refresh" : "Refreshing…"}
          </button>
        </section>
        <section class="viewer">
          <p><strong>Current focus</strong></p>
          <p class="muted">${escapeHtml(focusText)}</p>

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
                  ${state.roster.map((member) => html`
                    <li>
                      <strong>${escapeHtml(member.name)}</strong>
                      <span class="muted"> — ${escapeHtml(member.role)}</span>
                    </li>
                  `)}
                </ul>
              `}
        </section>
      `;
    },
  };
}

function createSquadStatusLabel() {
  return {
    id: "workspace.status",
    order: 20,
    items: (context) => {
      const state = ensureStatusState(context);
      const text = compactText(state.text, MAX_LABEL_LENGTH);
      return [{
        type: "text",
        text: escapeHtml(text),
        title: escapeHtml(state.text),
      }];
    },
  };
}

function createSquadCommand() {
  return {
    id: "run-squad",
    title: "Run /squad",
    description: "Send the /squad command to the selected Pi session.",
    group: "Squad",
    enabled: (context) => context.state.selectedWorkspace !== undefined,
    run: async (context) => {
      if (context.state.selectedSession === undefined) {
        await Promise.resolve(context.startSession()).catch(() => undefined);
      }

      const promptEditor = await findPromptEditor();
      if (typeof promptEditor?.focusInput === "function") {
        promptEditor.focusInput();
      } else {
        context.focusPrompt();
      }

      if (typeof promptEditor?.onSend === "function") {
        promptEditor.onSend(SQUAD_COMMAND);
        return;
      }

      const clipboard = globalThis.navigator?.clipboard;
      if (clipboard?.writeText) {
        await clipboard.writeText(SQUAD_COMMAND).catch(() => undefined);
      }
    },
  };
}

function ensurePanelState(context) {
  const key = workspaceKey(context);
  let state = panelCache.get(key);
  if (state === undefined) {
    state = {
      status: "loading",
      roster: [],
      focus: null,
      latestActivity: null,
      decisionCount: null,
      request: undefined,
      lastLoadedAt: undefined,
    };
    panelCache.set(key, state);
  }

  if (state.request === undefined && shouldRefresh(state.lastLoadedAt, PANEL_REFRESH_TTL_MS)) {
    state.request = loadPanelState(context, state).finally(() => {
      state.request = undefined;
    });
  }

  return state;
}

function refreshPanelState(context, state) {
  if (state.request !== undefined) return state.request;
  state.status = "loading";
  requestHostRender(context.host);
  state.request = loadPanelState(context, state).finally(() => {
    state.request = undefined;
  });
  return state.request;
}

async function loadPanelState(context, state) {
  try {
    const [teamMarkdown, focusMarkdown, decisionsMarkdown, latestActivity] = await Promise.all([
      readWorkspaceText(context.workspace, `${DEFAULT_SQUAD_ROOT}/team.md`),
      readWorkspaceText(context.workspace, `${DEFAULT_SQUAD_ROOT}/identity/now.md`),
      readWorkspaceText(context.workspace, `${DEFAULT_SQUAD_ROOT}/decisions.md`),
      readLatestActivity(context.workspace, DEFAULT_SQUAD_ROOT),
    ]);
    state.roster = parseTeamRoster(teamMarkdown);
    state.focus = normalizeExcerpt(focusMarkdown, MAX_FOCUS_LENGTH);
    state.latestActivity = latestActivity;
    state.decisionCount = countDecisions(decisionsMarkdown);
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

function ensureStatusState(context) {
  const key = workspaceKey(context);
  let state = statusCache.get(key);
  if (state === undefined) {
    state = { text: DEFAULT_STATUS, request: undefined, lastLoadedAt: undefined };
    statusCache.set(key, state);
  }

  if (state.request === undefined && shouldRefresh(state.lastLoadedAt, STATUS_REFRESH_TTL_MS)) {
    state.request = loadStatusState(context, state).finally(() => {
      state.request = undefined;
    });
  }

  return state;
}

async function loadStatusState(context, state) {
  const [decisionsMarkdown, latestActivity] = await Promise.all([
    readWorkspaceText(context.workspace, `${DEFAULT_SQUAD_ROOT}/decisions.md`),
    readLatestActivity(context.workspace, DEFAULT_SQUAD_ROOT),
  ]);
  state.text = summarizeStatus(latestActivity, parseLastDecision(decisionsMarkdown));
  state.lastLoadedAt = Date.now();
  requestHostRender(context.host);
}

function summarizeStatus(latestActivity, lastDecision) {
  if (latestActivity?.modifiedAt) {
    const modifiedAt = Date.parse(latestActivity.modifiedAt);
    if (!Number.isNaN(modifiedAt) && Date.now() - modifiedAt <= ACTIVE_WINDOW_MS) {
      return `🔄 ${latestActivity.agentName} working`;
    }
  }
  return lastDecision ?? DEFAULT_STATUS;
}

async function readWorkspaceText(workspace, filePath) {
  try {
    const response = await fetch(workspaceApiUrl(workspace, "file", filePath), { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();
    if (payload.binary || typeof payload.content !== "string") return null;
    return payload.content;
  } catch {
    return null;
  }
}

async function listWorkspaceDirectory(workspace, directoryPath) {
  try {
    const response = await fetch(workspaceApiUrl(workspace, "tree", directoryPath), { cache: "no-store" });
    if (!response.ok) return [];
    const payload = await response.json();
    if (!Array.isArray(payload.entries)) return [];
    return payload.entries.filter(isDirectoryEntry).map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type,
      modifiedAt: typeof entry.modifiedAt === "string" ? entry.modifiedAt : undefined,
    }));
  } catch {
    return [];
  }
}

async function readLatestActivity(workspace, squadRoot) {
  const entries = await listWorkspaceDirectory(workspace, `${squadRoot}/orchestration-log`);
  const latestEntry = entries
    .filter((entry) => entry.type === "file" && entry.name.endsWith(".md"))
    .sort(compareEntriesByModifiedDesc)[0];
  if (!latestEntry) return null;

  const markdown = await readWorkspaceText(workspace, `${squadRoot}/orchestration-log/${latestEntry.name}`);
  const parsed = parseLatestActivity(markdown);
  return parsed === null ? null : { ...parsed, modifiedAt: latestEntry.modifiedAt };
}

function parseTeamRoster(markdown) {
  if (typeof markdown !== "string" || markdown.trim() === "") return [];
  const section = extractSection(markdown, "Members");
  if (section === null) return [];

  const roster = [];
  for (const line of section.split(/\r?\n/u)) {
    const cells = parseTableRow(line);
    if (cells === null || cells.length < 2) continue;
    if (isSeparatorRow(cells)) continue;
    if ((cells[0] ?? "").toLowerCase() === "name" && (cells[1] ?? "").toLowerCase() === "role") continue;

    const name = stripMarkdown(cells[0] ?? "");
    const role = stripMarkdown(cells[1] ?? "");
    if (name !== "" && role !== "") roster.push({ name, role });
  }

  return roster;
}

function countDecisions(markdown) {
  if (typeof markdown !== "string" || markdown.trim() === "") return null;
  const matches = markdown.match(/^##\s+/gmu);
  return matches?.length ?? 0;
}

function parseLatestActivity(markdown) {
  if (typeof markdown !== "string" || markdown.trim() === "") return null;

  const lines = markdown.split(/\r?\n/u);
  const headingLine = lines.find((line) => line.startsWith("# "));
  const heading = headingLine ? normalizeWhitespace(stripMarkdown(headingLine.replace(/^#\s+/u, ""))) : null;
  const agentName = normalizeAgentName(readLabeledValue(lines, "Agent"))
    ?? inferAgentNameFromHeading(heading)
    ?? "Squad";
  const task = readLabeledValue(lines, "Action")
    ?? readLabeledValue(lines, "Directive")
    ?? readLabeledValue(lines, "Ceremony")
    ?? readLabeledValue(lines, "Scope")
    ?? inferTaskFromHeading(heading, agentName)
    ?? firstMeaningfulSentence(lines.slice(1));
  if (task === null) return null;

  return {
    agentName,
    task: compactText(normalizeWhitespace(stripMarkdown(task)), MAX_ACTIVITY_LENGTH),
  };
}

function parseLastDecision(markdown) {
  if (typeof markdown !== "string" || markdown.trim() === "") return null;

  const lines = markdown.split(/\r?\n/u).slice(-MAX_DECISION_LINES);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = (lines[index] ?? "").trim();
    if (!line.startsWith("## ")) continue;

    const heading = stripMarkdown(line.slice(3));
    const detail = firstMeaningfulSentence(lines.slice(index + 1));
    const summary = detail === null ? heading : `${heading} — ${detail}`;
    return compactText(normalizeWhitespace(summary), MAX_STATUS_LENGTH);
  }

  return null;
}

function extractSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/u);
  let inSection = false;
  const collected = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (inSection) break;
      inSection = line.slice(3).trim() === heading;
      continue;
    }
    if (inSection) collected.push(line);
  }

  return collected.length > 0 ? collected.join("\n") : null;
}

function parseTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  return trimmed
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function normalizeExcerpt(markdown, limit) {
  const normalized = normalizeWhitespace(stripMarkdown(markdown ?? ""));
  if (normalized === "") return null;
  return compactText(normalized, limit);
}

function firstMeaningfulSentence(lines) {
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed === ""
      || trimmed === "---"
      || trimmed.startsWith("## ")
      || trimmed.startsWith("**By:**")
      || trimmed.startsWith("**Status:**")
      || trimmed.startsWith("**Date:**")
      || trimmed.startsWith("**Agent:**")
      || trimmed.startsWith("**Session:**")
    ) {
      continue;
    }

    const plain = normalizeWhitespace(stripMarkdown(trimmed.replace(/^[-*]\s+/u, "")));
    if (plain === "") continue;
    return firstSentence(plain);
  }

  return null;
}

function firstSentence(text) {
  const match = text.match(/^(.*?[.!?])(?:\s|$)/u);
  return match?.[1] ?? text;
}

function readLabeledValue(lines, label) {
  const pattern = new RegExp(`^\\*\\*${escapeRegex(label)}:\\*\\*\\s*(.+)$`, "u");
  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) continue;
    const value = normalizeWhitespace(stripMarkdown(match[1] ?? ""));
    if (value !== "") return firstSentence(value);
  }
  return null;
}

function normalizeAgentName(raw) {
  if (raw === null) return null;
  const plain = normalizeWhitespace(stripMarkdown(raw));
  if (plain === "") return null;
  return plain.split(/\s+[(-]/u)[0] ?? null;
}

function inferAgentNameFromHeading(heading) {
  if (heading === null || heading === "") return null;
  const stripped = heading.replace(/^\d{4}[^:]*:\s*/u, "").replace(/\s+\([^)]*\)$/u, "");
  const [candidate] = stripped.split(/\s+—\s+/u, 1);
  const agentName = normalizeWhitespace((candidate ?? "").replace(/\s+Orchestration$/u, ""));
  return agentName === "" ? null : agentName;
}

function inferTaskFromHeading(heading, agentName) {
  if (heading === null || heading === "") return null;
  const stripped = heading.replace(/^\d{4}[^:]*:\s*/u, "").replace(/\s+\([^)]*\)$/u, "");
  const parts = stripped.split(/\s+—\s+/u);
  if (parts.length >= 2) return parts.slice(1).join(" — ");

  const compact = stripped.replace(new RegExp(`^${escapeRegex(agentName)}\\s+`, "u"), "").trim();
  return compact === "" ? null : compact;
}

function stripMarkdown(text) {
  return String(text)
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[`*_>#]/gu, "")
    .replace(/\|/gu, " ")
    .trim();
}

function normalizeWhitespace(text) {
  return String(text).replace(/\s+/gu, " ").trim();
}

function compactText(text, limit) {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function compareEntriesByModifiedDesc(a, b) {
  return toTimestamp(b.modifiedAt) - toTimestamp(a.modifiedAt) || a.name.localeCompare(b.name);
}

function toTimestamp(value) {
  if (value === undefined) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function workspaceApiUrl(workspace, endpoint, path) {
  return `/api/projects/${encodeURIComponent(workspace.projectId)}`
    + `/workspaces/${encodeURIComponent(workspace.id)}`
    + `/${endpoint}?path=${encodeURIComponent(path)}`;
}

function isDirectoryEntry(value) {
  return typeof value === "object"
    && value !== null
    && typeof value.name === "string"
    && typeof value.path === "string"
    && (value.type === "file" || value.type === "directory" || value.type === "symlink");
}

function requestHostRender(host) {
  host?.requestRender?.();
}

function shouldRefresh(lastLoadedAt, ttlMs) {
  return lastLoadedAt === undefined || Date.now() - lastLoadedAt >= ttlMs;
}

function workspaceKey(context) {
  return `${context.workspace.projectId}:${context.workspace.id}`;
}

function escapeHtml(raw) {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findPromptEditor(timeoutMs = 1500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const promptEditor = document.querySelector("prompt-editor");
    if (promptEditor instanceof Element) return promptEditor;
    await sleep(100);
  }
  return null;
}

function sleep(durationMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}
