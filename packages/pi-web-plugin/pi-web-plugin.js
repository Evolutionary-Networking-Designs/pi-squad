const DEFAULT_SQUAD_ROOT = ".squad";
const DEFAULT_STATUS = "Squad ready";
const MAX_FOCUS_LENGTH = 200;
const MAX_STATUS_LENGTH = 120;
const MAX_LABEL_LENGTH = 40;
const MAX_DECISION_LINES = 80;

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

      return html`
        <section class="toolbar"><strong>Squad</strong></section>
        <section class="viewer">
          <p><strong>Current focus</strong></p>
          <p class="muted">${focusText}</p>

          <p><strong>Members</strong></p>
          ${state.roster.length === 0
            ? html`<p class="empty">No team roster available.</p>`
            : html`
                <ul>
                  ${state.roster.map((member) => html`
                    <li>
                      <strong>${member.name}</strong>
                      <span class="muted"> — ${member.role}</span>
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
      return [{
        type: "text",
        text: compactText(state.text, MAX_LABEL_LENGTH),
        title: state.text,
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
    state = { status: "loading", roster: [], focus: null, request: undefined };
    panelCache.set(key, state);
  }

  if (state.request === undefined) {
    state.request = loadPanelState(context, state).finally(() => {
      state.request = undefined;
    });
  }

  return state;
}

async function loadPanelState(context, state) {
  try {
    const [teamMarkdown, focusMarkdown] = await Promise.all([
      readWorkspaceText(context, `${DEFAULT_SQUAD_ROOT}/team.md`),
      readWorkspaceText(context, `${DEFAULT_SQUAD_ROOT}/identity/now.md`),
    ]);
    state.roster = parseTeamRoster(teamMarkdown);
    state.focus = normalizeExcerpt(focusMarkdown, MAX_FOCUS_LENGTH);
    state.status = "ready";
  } catch {
    state.roster = [];
    state.focus = null;
    state.status = "error";
  }

  context.host.requestRender();
}

function ensureStatusState(context) {
  const key = workspaceKey(context);
  let state = statusCache.get(key);
  if (state === undefined) {
    state = { text: DEFAULT_STATUS, request: undefined };
    statusCache.set(key, state);
  }

  if (state.request === undefined) {
    state.request = loadStatusState(context, state).finally(() => {
      state.request = undefined;
    });
  }

  return state;
}

async function loadStatusState(context, state) {
  const decisionsMarkdown = await readWorkspaceText(context, `${DEFAULT_SQUAD_ROOT}/decisions.md`);
  state.text = parseLastDecision(decisionsMarkdown) ?? DEFAULT_STATUS;
  context.host.requestRender();
}

async function readWorkspaceText(context, filePath) {
  try {
    const file = await context.files.readFile(filePath);
    if (file.binary || typeof file.content !== "string") return null;
    return file.content;
  } catch {
    return null;
  }
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

function normalizeExcerpt(markdown, limit) {
  const normalized = normalizeWhitespace(stripMarkdown(markdown ?? ""));
  if (normalized === "") return null;
  return compactText(normalized, limit);
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

function firstMeaningfulSentence(lines) {
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed === ""
      || trimmed === "---"
      || trimmed.startsWith("## ")
      || trimmed.startsWith("**By:**")
      || trimmed.startsWith("**Status:**")
    ) {
      continue;
    }

    const plain = normalizeWhitespace(stripMarkdown(trimmed.replace(/^[-*]\s+/u, "")));
    if (plain === "") continue;
    const match = plain.match(/^(.*?[.!?])(?:\s|$)/u);
    return match?.[1] ?? plain;
  }

  return null;
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

function workspaceKey(context) {
  return `${context.machine.id}:${context.workspace.id}`;
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
