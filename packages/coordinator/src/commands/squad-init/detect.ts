import { execSync } from "node:child_process";
import { basename } from "node:path";

import type { InitContext } from "../../coordinator/coordinator.js";

export async function probeModule(specifier: string): Promise<boolean> {
  try {
    await import.meta.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

export const KNOWN_RPIV_EXTENSIONS = [
  "@juicesharp/rpiv-ask-user-question",
  "@juicesharp/rpiv-todo",
  "@juicesharp/rpiv-advisor",
  "@juicesharp/rpiv-telemetry",
  "@juicesharp/rpiv-workflow",
] as const;

export async function detectEnvironment(cwd: string): Promise<InitContext> {
  let userName: string | null = null;
  try {
    userName =
      execSync("git config user.name", {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null;
  } catch {
    // git not available or no config — proceed without name
  }

  const projectName = basename(cwd) || "my-project";

  const detectedExtensions: string[] = [];
  for (const ext of KNOWN_RPIV_EXTENSIONS) {
    if (await probeModule(ext)) {
      detectedExtensions.push(ext);
    }
  }

  return { userName, projectName, detectedExtensions };
}
