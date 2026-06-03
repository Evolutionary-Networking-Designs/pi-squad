/**
 * @module upstream/sync
 *
 * Upstream Squad sync utilities — infrastructure tooling used by scripts/sync-squad.ts,
 * NOT invoked at extension runtime.
 *
 * Downloads Squad tarballs from bradygaster/squad GitHub releases, extracts them
 * into the squad/ vendored directory, and checks for available updates.
 *
 * Design reference: docs/ARCHITECTURE.md §4.1
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import semver from "semver";
import { readVendoredVersion, checkCompatibility } from "./version.js";
const execFileAsync = promisify(execFile);
// ─── Internal helpers ─────────────────────────────────────────────────────────
async function pathExists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    }
    catch {
        return false;
    }
}
async function countFilesRecursive(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
        if (entry.isDirectory()) {
            total += await countFilesRecursive(path.join(dir, entry.name));
        }
        else {
            total += 1;
        }
    }
    return total;
}
async function downloadTarball(url, destPath) {
    const response = await fetch(url, { headers: { "user-agent": "pi-squad-sync" } });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${url}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(destPath, buffer);
}
async function extractTarball(tarballPath, destDir) {
    await fs.mkdir(destDir, { recursive: true });
    await execFileAsync("tar", ["-xzf", tarballPath, "-C", destDir]);
    const entries = await fs.readdir(destDir, { withFileTypes: true });
    const rootDir = entries.find((e) => e.isDirectory());
    if (!rootDir) {
        throw new Error("Extracted Squad archive contained no root directory");
    }
    return path.join(destDir, rootDir.name);
}
// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Check GitHub releases for a newer Squad version without downloading.
 * Returns { available: false, latestVersion: currentVersion } on any network error.
 */
export async function checkForUpdates(currentVersion) {
    try {
        const response = await fetch("https://api.github.com/repos/bradygaster/squad/releases/latest", { headers: { "user-agent": "pi-squad-check-version" } });
        if (!response.ok) {
            return { available: false, latestVersion: currentVersion };
        }
        const data = (await response.json());
        const rawTag = data.tag_name ?? "";
        const latestVersion = semver.valid(semver.coerce(rawTag)) ?? currentVersion;
        const available = semver.valid(currentVersion) !== null &&
            semver.gt(latestVersion, currentVersion);
        return { available, latestVersion };
    }
    catch {
        return { available: false, latestVersion: currentVersion };
    }
}
/**
 * Download Squad at the requested version and extract it into options.targetDir.
 * When checkOnly is true, validates the version range but makes no filesystem changes.
 *
 * Uses a temporary work directory adjacent to targetDir for staging.
 * Cleans up the work directory on success or failure.
 */
export async function syncSquadUpstream(options) {
    const { version, targetDir } = options;
    const normVersion = semver.valid(semver.coerce(version));
    if (!normVersion) {
        throw new Error(`Invalid Squad version: "${version}"`);
    }
    // Resolve team root as the parent of targetDir
    const teamRoot = path.dirname(path.resolve(targetDir));
    // Read current vendored version (fallback to "0.0.0" if not yet vendored)
    let previousVersion = "0.0.0";
    try {
        const meta = await readVendoredVersion(teamRoot);
        previousVersion = meta.version;
    }
    catch {
        // First sync — no VERSION file yet
    }
    // Compatibility check
    const packageJsonPath = path.join(teamRoot, "package.json");
    let minVersion = "0.9.0";
    let maxVersion = "0.11.0";
    try {
        const pkgRaw = await fs.readFile(packageJsonPath, "utf8");
        const pkg = JSON.parse(pkgRaw);
        minVersion = pkg.squad?.minVersion ?? minVersion;
        maxVersion = pkg.squad?.maxVersion ?? maxVersion;
    }
    catch {
        // Use defaults
    }
    const compatResult = checkCompatibility(normVersion, {
        version: previousVersion,
        minVersion,
        maxVersion,
    });
    if (!compatResult.compatible) {
        console.warn(`[pi-squad] sync-squad: ${compatResult.reason ?? "version out of range"} — proceeding anyway`);
    }
    if (options.checkOnly) {
        return {
            previousVersion,
            newVersion: normVersion,
            filesChanged: 0,
            compatible: compatResult.compatible,
        };
    }
    const tag = `v${normVersion}`;
    const tarballUrl = `https://github.com/bradygaster/squad/archive/refs/tags/${tag}.tar.gz`;
    const workDir = path.join(teamRoot, ".sync-squad-work");
    const tarballPath = path.join(workDir, `${tag}.tar.gz`);
    const extractDir = path.join(workDir, "extract");
    try {
        await fs.rm(workDir, { recursive: true, force: true });
        await fs.mkdir(workDir, { recursive: true });
        await downloadTarball(tarballUrl, tarballPath);
        const sourceRoot = await extractTarball(tarballPath, extractDir);
        // Wipe and recreate targetDir
        await fs.rm(targetDir, { recursive: true, force: true });
        await fs.mkdir(targetDir, { recursive: true });
        // Copy extracted content
        await fs.cp(sourceRoot, targetDir, { recursive: true, force: true });
        // Write VERSION file
        const versionFilePath = path.join(targetDir, "VERSION");
        await fs.writeFile(versionFilePath, `${normVersion}\n`, "utf8");
        const filesChanged = await countFilesRecursive(targetDir);
        return {
            previousVersion,
            newVersion: normVersion,
            filesChanged,
            compatible: compatResult.compatible,
        };
    }
    finally {
        if (await pathExists(workDir)) {
            await fs.rm(workDir, { recursive: true, force: true });
        }
    }
}
//# sourceMappingURL=sync.js.map