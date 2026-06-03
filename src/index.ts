/**
 * @module index
 * Extension entry point — wires the Squad coordinator into the Pi CLI.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import semver from "semver";

import { probeModule, registerBuiltinAskUserQuestion } from "./commands/squad-init/ask-user-question/register.js";
import { registerSquadInitCommand } from "./commands/squad-init.js";
import { initializeCoordinator } from "./coordinator/coordinator.js";
import { buildSystemPrompt } from "./coordinator/system-prompt.js";
import { initializeWorkMonitor } from "./ralph/work-monitor.js";
import { checkCompatibility } from "./upstream/version.js";

const HOOK_TIMEOUT_MS = 10_000;
const COMMAND_TIMEOUT_MS = 30_000;
const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SQUAD_DIR = fileURLToPath(new URL("../squad/", import.meta.url));
const SQUAD_PACKAGE_JSON = fileURLToPath(new URL("../squad/package.json", import.meta.url));
const COORDINATOR_PACKAGE_JSON = fileURLToPath(new URL("../package.json", import.meta.url));

interface SquadPackageJson {
  version?: string;
}

interface CoordinatorPackageSquadMeta {
  version?: string;
  minVersion?: string;
  maxVersion?: string;
  commit?: string;
}

interface CoordinatorPackageJson {
  version?: string;
  squad?: CoordinatorPackageSquadMeta;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`[pi-squad] before_agent_start hook timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function getNormalizedVersion(version: string): string | null {
  return semver.valid(version) ?? semver.coerce(version)?.version ?? null;
}

function versionsEqual(left: string, right: string): boolean {
  const normalizedLeft = getNormalizedVersion(left);
  const normalizedRight = getNormalizedVersion(right);
  if (normalizedLeft && normalizedRight) {
    return semver.eq(normalizedLeft, normalizedRight);
  }

  return left.trim().replace(/^v/, "") === right.trim().replace(/^v/, "");
}

function isNewerVersion(candidate: string, current: string): boolean {
  const normalizedCandidate = getNormalizedVersion(candidate);
  const normalizedCurrent = getNormalizedVersion(current);
  if (normalizedCandidate && normalizedCurrent) {
    return semver.gt(normalizedCandidate, normalizedCurrent);
  }

  return !versionsEqual(candidate, current);
}

function firstNonEmptyLine(text: string): string | null {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? null;
}

function formatVersionLabel(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

async function runCommand(
  pi: ExtensionAPI,
  command: string,
  args: string[],
  cwd: string,
): Promise<string> {
  const result = await pi.exec(command, args, { cwd, timeout: COMMAND_TIMEOUT_MS });
  if (result.code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.code}: ${result.stderr.trim()}`,
    );
  }

  return result.stdout.trim();
}

async function readSquadVersion(): Promise<string> {
  const pkg = await readJsonFile<SquadPackageJson>(SQUAD_PACKAGE_JSON);
  const version = pkg.version?.trim();
  if (!version) {
    throw new Error("[pi-squad] squad/package.json is missing a version field");
  }
  return version;
}

async function readCoordinatorPackage(): Promise<CoordinatorPackageJson> {
  return readJsonFile<CoordinatorPackageJson>(COORDINATOR_PACKAGE_JSON);
}

async function getLatestSquadTag(pi: ExtensionAPI): Promise<string | null> {
  await runCommand(pi, "git", ["fetch", "--tags", "--quiet"], SQUAD_DIR);
  const tags = await runCommand(pi, "git", ["tag", "--sort=-v:refname"], SQUAD_DIR);
  return firstNonEmptyLine(tags);
}

async function getCurrentSquadRef(pi: ExtensionAPI, fallbackVersion: string): Promise<string> {
  const exactTag = await pi.exec("git", ["describe", "--tags", "--exact-match"], {
    cwd: SQUAD_DIR,
    timeout: COMMAND_TIMEOUT_MS,
  });
  if (exactTag.code === 0) {
    const tag = exactTag.stdout.trim();
    if (tag.length > 0) {
      return tag;
    }
  }

  const currentCommit = await pi.exec("git", ["rev-parse", "HEAD"], {
    cwd: SQUAD_DIR,
    timeout: COMMAND_TIMEOUT_MS,
  });
  if (currentCommit.code === 0) {
    const commit = currentCommit.stdout.trim();
    if (commit.length > 0) {
      return commit;
    }
  }

  return formatVersionLabel(fallbackVersion);
}

async function restoreSquadState(
  pi: ExtensionAPI,
  previousRef: string,
  previousPackageJson: string,
): Promise<void> {
  await writeFile(COORDINATOR_PACKAGE_JSON, previousPackageJson, "utf8");
  await runCommand(pi, "git", ["checkout", previousRef], SQUAD_DIR);
}

async function checkSquadUpdate(pi: ExtensionAPI): Promise<void> {
  try {
    const [currentVersion, latestTag] = await Promise.all([readSquadVersion(), getLatestSquadTag(pi)]);
    if (!latestTag || !isNewerVersion(latestTag, currentVersion)) {
      return;
    }

    console.log(
      `[pi-squad] Squad ${formatVersionLabel(latestTag)} available — update with /squad-update`,
    );
  } catch {
    // Silent by design — offline or uninitialized submodule should not disrupt startup.
  }
}

async function checkCoordinatorUpdate(pi: ExtensionAPI): Promise<void> {
  try {
    const pkg = await readCoordinatorPackage();
    const installedVersion = pkg.version?.trim();
    if (!installedVersion) {
      return;
    }

    const latestResult = await pi.exec("npm", ["view", "@pi-squad/coordinator", "version"], {
      cwd: PACKAGE_ROOT,
      timeout: COMMAND_TIMEOUT_MS,
    });
    if (latestResult.code !== 0) {
      return;
    }

    const latestVersion = firstNonEmptyLine(latestResult.stdout);
    if (!latestVersion || !isNewerVersion(latestVersion, installedVersion)) {
      return;
    }

    const updateResult = await pi.exec(
      "pi",
      ["update", "--extension", "@pi-squad/coordinator"],
      { cwd: PACKAGE_ROOT, timeout: COMMAND_TIMEOUT_MS },
    );
    if (updateResult.code === 0) {
      console.log("[pi-squad] @pi-squad/coordinator updated — run /reload to apply");
      return;
    }

    console.warn(
      `[pi-squad] Failed to update @pi-squad/coordinator automatically: ${updateResult.stderr.trim()}`,
    );
  } catch {
    // Silent on lookup failures — package may not be published yet or network may be unavailable.
  }
}

export default async function (pi: ExtensionAPI): Promise<void> {
  const coordinator = await initializeCoordinator(pi);
  const rpivPresent = await probeModule("@juicesharp/rpiv-ask-user-question");
  if (!rpivPresent) {
    registerBuiltinAskUserQuestion(pi);
  }
  const ralph = await initializeWorkMonitor(pi, { coordinator });

  void Promise.allSettled([
    checkSquadUpdate(pi).catch(() => {}),
    checkCoordinatorUpdate(pi).catch(() => {}),
  ]);

  pi.on("before_agent_start", async (event, _ctx) => {
    try {
      const hookWork = async () => {
        const coordinatorPrompt = await coordinator.getSystemPrompt();
        const systemPrompt = await buildSystemPrompt(event.systemPrompt, coordinatorPrompt, coordinator);
        const assessment = await coordinator.assessContext(systemPrompt);
        await ralph.recordContextAssessment(assessment);
        return { systemPrompt };
      };

      return await withTimeout(hookWork(), HOOK_TIMEOUT_MS);
    } catch (error) {
      console.warn(
        `[pi-squad] before_agent_start hook failed; degrading to default system prompt. ${String(error)}`,
      );
      return { systemPrompt: event.systemPrompt };
    }
  });

  pi.registerCommand("squad", {
    description: "Invoke Squad coordinator for team routing",
    handler: async (args, ctx) => {
      await coordinator.route(args, ctx);
    },
  });

  registerSquadInitCommand(pi, coordinator);

  pi.registerCommand("squad-update", {
    description: "Sync Squad upstream and reload",
    handler: async (_args, ctx) => {
      console.log("[pi-squad] Running squad-update...");

      let previousPackageJson = "";
      let previousRef = "";
      let checkedOutNewTag = false;
      let packageJsonUpdated = false;

      try {
        previousPackageJson = await readFile(COORDINATOR_PACKAGE_JSON, "utf8");
        const currentVersion = await readSquadVersion();
        previousRef = await getCurrentSquadRef(pi, currentVersion);

        const latestTag = await getLatestSquadTag(pi);
        if (!latestTag || !isNewerVersion(latestTag, currentVersion)) {
          console.log(`[pi-squad] Squad is already up to date (${formatVersionLabel(currentVersion)}).`);
          return;
        }

        await runCommand(pi, "git", ["checkout", latestTag], SQUAD_DIR);
        checkedOutNewTag = true;

        const nextVersion = await readSquadVersion();
        const coordinatorPackage = JSON.parse(previousPackageJson) as CoordinatorPackageJson;
        const updatedPackage: CoordinatorPackageJson = {
          ...coordinatorPackage,
          squad: {
            ...coordinatorPackage.squad,
            version: nextVersion,
          },
        };
        await writeFile(COORDINATOR_PACKAGE_JSON, `${JSON.stringify(updatedPackage, null, 2)}\n`, "utf8");
        packageJsonUpdated = true;

        const compatibility = checkCompatibility(nextVersion, {
          version: nextVersion,
          minVersion: updatedPackage.squad?.minVersion ?? "0.0.0",
          maxVersion: updatedPackage.squad?.maxVersion ?? "99.99.99",
          commit: updatedPackage.squad?.commit,
        });
        if (!compatibility.compatible) {
          console.warn(
            `[pi-squad] ${compatibility.reason ?? "Squad version is incompatible"}; reverting update.`,
          );
          await restoreSquadState(pi, previousRef, previousPackageJson);
          return;
        }

        console.log(`[pi-squad] Squad updated to ${formatVersionLabel(nextVersion)} — reloading...`);
        await ctx.reload();
      } catch (error) {
        if ((checkedOutNewTag || packageJsonUpdated) && previousPackageJson.length > 0 && previousRef.length > 0) {
          try {
            await restoreSquadState(pi, previousRef, previousPackageJson);
          } catch (restoreError) {
            console.warn(`[pi-squad] Failed to restore previous Squad state: ${String(restoreError)}`);
          }
        }

        console.warn(`[pi-squad] squad-update failed: ${String(error)}`);
      }
    },
  });
}

