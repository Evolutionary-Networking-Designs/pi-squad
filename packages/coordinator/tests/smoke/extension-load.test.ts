import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { isPiAvailable } from "../helpers/pi-available.js";
import {
  createTmuxSession,
  isTmuxAvailable,
  isTmuxConfigured,
  type TmuxSession,
} from "../helpers/tmux.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../../..");
const WORKSPACE_EXTENSION = resolve(REPO_ROOT, "packages/coordinator/src/index.ts");
const PI_EXTENSION_ARGS = [
  "--no-extensions",
  "--extension",
  WORKSPACE_EXTENSION,
] as const;
const SMOKE = !!process.env["PISQUAD_SMOKE"];
const PI_OK = isPiAvailable();
const TMUX_OK = isTmuxAvailable();
const TMUX_CONFIGURED = isTmuxConfigured();
const RPC_TIMEOUT_MS = 30_000;
const RPC_SETTLE_MS = 1_000;

type RpcAgentMessage = {
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
};

type RpcAgentEndEvent = {
  type: "agent_end";
  messages?: RpcAgentMessage[];
};

function extractAssistantText(event: RpcAgentEndEvent | null): string {
  if (!event?.messages) {
    return "";
  }

  return event.messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.content ?? [])
    .filter((content) => content.type === "text" && typeof content.text === "string")
    .map((content) => content.text ?? "")
    .join("\n")
    .trim();
}

describe.skipIf(!SMOKE)("smoke: extension-load", () => {
  // Track any tmux sessions opened during this suite for cleanup.
  let activeSession: TmuxSession | undefined;

  afterEach(async () => {
    try {
      await activeSession?.kill();
    } catch {
      // Best-effort cleanup
    }
    activeSession = undefined;
  });

  it.skipIf(!PI_OK)(
    "pi non-interactive prompt exits 0 and contains pong",
    () => {
      const result = spawnSync(
        "pi",
        [...PI_EXTENSION_ARGS, "-p", "say exactly: pong", "--no-session"],
        { cwd: REPO_ROOT, timeout: 60_000, encoding: "utf8" }
      );

      expect(result.status, result.error?.message ?? result.stderr ?? result.stdout ?? "").toBe(0);
      const output = (result.stdout ?? "") + (result.stderr ?? "");
      expect(output.toLowerCase()).toContain("pong");
    },
    90_000
  );

  it.skipIf(!PI_OK)(
    "hook injection: team member names appear in output",
    () => {
      const result = spawnSync(
        "pi",
        [...PI_EXTENSION_ARGS, "-p", "who is on the team", "--no-session"],
        { cwd: REPO_ROOT, timeout: 60_000, encoding: "utf8" }
      );

      expect(result.status, result.error?.message ?? result.stderr ?? result.stdout ?? "").toBe(0);

      const output = (result.stdout ?? "") + (result.stderr ?? "");
      const teamNames = ["Motoko", "Batou", "Togusa", "Ishikawa", "Proto"];
      const found = teamNames.some((name) => output.includes(name));
      expect(found, `Expected at least one team member name in output:\n${output}`).toBe(true);
    },
    90_000
  );

  it.skipIf(!PI_OK)(
    "/squad command: rpc invocation",
    async () => {
      const pi = spawn(
        "pi",
        ["--mode", "rpc", ...PI_EXTENSION_ARGS, "--no-session"],
        { cwd: REPO_ROOT, stdio: ["pipe", "pipe", "pipe"] }
      );

      let stdout = "";
      let stderr = "";
      let buffer = "";
      let agentEndEvent: RpcAgentEndEvent | null = null;
      let promptAccepted = false;

      try {
        await new Promise<void>((resolve, reject) => {
          let settleTimer: NodeJS.Timeout | undefined;
          const timeout = setTimeout(() => {
            if (pi.exitCode === null && !pi.killed) {
              pi.kill("SIGTERM");
            }
            reject(new Error(`RPC timeout\nstdout:\n${stdout}\nstderr:\n${stderr}`));
          }, RPC_TIMEOUT_MS);

          const scheduleShutdown = () => {
            if (settleTimer) {
              return;
            }

            settleTimer = setTimeout(() => {
              if (pi.exitCode === null && !pi.killed) {
                pi.kill("SIGTERM");
              }
            }, RPC_SETTLE_MS);
          };

          const cleanup = () => {
            clearTimeout(timeout);
            if (settleTimer) {
              clearTimeout(settleTimer);
            }
            pi.stdout.off("data", onStdout);
            pi.stderr.off("data", onStderr);
            pi.off("error", onError);
            pi.off("close", onClose);
          };

          const finish = () => {
            cleanup();
            resolve();
          };

          const fail = (error: Error) => {
            cleanup();
            reject(error);
          };

          const onStdout = (chunk: Buffer) => {
            const text = chunk.toString("utf8");
            stdout += text;
            buffer += text;
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.trim()) {
                continue;
              }

              try {
                const event = JSON.parse(line) as {
                  type?: string;
                  command?: string;
                  success?: boolean;
                  messages?: RpcAgentMessage[];
                };
                if (event.type === "response" && event.command === "prompt" && event.success) {
                  promptAccepted = true;
                  scheduleShutdown();
                  continue;
                }

                if (event.type === "agent_end") {
                  agentEndEvent = { type: "agent_end", messages: event.messages };
                  promptAccepted = true;
                  scheduleShutdown();
                }
              } catch {
                // Ignore non-JSON output lines; RPC transport is stdout JSONL but startup noise should not fail the test.
              }
            }
          };

          const onStderr = (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
            if (promptAccepted) {
              scheduleShutdown();
            }
          };

          const onError = (error: Error) => {
            fail(error);
          };

          const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
            if (promptAccepted) {
              finish();
              return;
            }

            fail(
              new Error(
                `pi exited before prompt completion (code=${code}, signal=${signal})\nstdout:\n${stdout}\nstderr:\n${stderr}`
              )
            );
          };

          pi.stdout.on("data", onStdout);
          pi.stderr.on("data", onStderr);
          pi.on("error", onError);
          pi.on("close", onClose);

          pi.stdin.write(JSON.stringify({ id: "req-1", type: "prompt", message: "/squad" }) + "\n");
        });
      } finally {
        if (pi.exitCode === null && !pi.killed) {
          pi.kill("SIGTERM");
        }
      }

      expect(promptAccepted, `Expected prompt response success\nstdout:\n${stdout}\nstderr:\n${stderr}`).toBe(true);

      const output = extractAssistantText(agentEndEvent);
      if (output.length > 0) {
        expect(output).toMatch(/squad|coordinator|team|error/i);
      } else {
        expect(`${stdout}\n${stderr}`).toMatch(/unknown routing directive|route guard violation|squad|coordinator/i);
      }
    },
    90_000
  );
});
