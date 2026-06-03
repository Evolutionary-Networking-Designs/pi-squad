import { execSync } from "node:child_process";
import { basename } from "node:path";
export async function probeModule(specifier) {
    try {
        await import.meta.resolve(specifier);
        return true;
    }
    catch {
        return false;
    }
}
export const KNOWN_RPIV_EXTENSIONS = [
    "@juicesharp/rpiv-ask-user-question",
    "@juicesharp/rpiv-todo",
    "@juicesharp/rpiv-advisor",
    "@juicesharp/rpiv-telemetry",
    "@juicesharp/rpiv-workflow",
];
export async function detectEnvironment(cwd) {
    let userName = null;
    try {
        userName =
            execSync("git config user.name", {
                cwd,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            }).trim() || null;
    }
    catch {
        // git not available or no config — proceed without name
    }
    const projectName = basename(cwd) || "my-project";
    const detectedExtensions = [];
    for (const ext of KNOWN_RPIV_EXTENSIONS) {
        if (await probeModule(ext)) {
            detectedExtensions.push(ext);
        }
    }
    return { userName, projectName, detectedExtensions };
}
//# sourceMappingURL=detect.js.map