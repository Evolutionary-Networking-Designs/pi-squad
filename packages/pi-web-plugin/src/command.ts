import type { PluginAction, PluginRuntimeContext } from "@jmfederico/pi-web/plugin-api";

const SQUAD_COMMAND = "/squad";

interface PromptEditorHandle extends Element {
  focusInput?: () => void;
  onSend?: (text: string, streamingBehavior?: "steer" | "followUp") => void;
}

export function createSquadCommand(): PluginAction {
  return {
    id: "run-squad",
    title: "Run /squad",
    description: "Send the /squad command to the selected Pi session.",
    group: "Squad",
    enabled: (context) => context.state.selectedWorkspace !== undefined,
    run: async (context) => {
      if (context.state.selectedSession === undefined) {
        try {
          await Promise.resolve(context.startSession());
        } catch {
          // Ignore session start failures and fall back to focusing the prompt.
        }
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

      await copyCommandToClipboard();
    },
  };
}

async function findPromptEditor(timeoutMs = 1500): Promise<PromptEditorHandle | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const promptEditor = document.querySelector("prompt-editor");
    if (promptEditor instanceof Element) return promptEditor as PromptEditorHandle;
    await sleep(100);
  }
  return null;
}

async function copyCommandToClipboard(): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard === undefined) return;
  await clipboard.writeText(SQUAD_COMMAND).catch(() => undefined);
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}
