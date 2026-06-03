/**
 * @module upstream/version
 *
 * Version compatibility guard for the vendored Squad source.
 * Reads squad/VERSION and package.json squad metadata, then validates
 * an upstream version string against the supported semver range.
 *
 * Emits console warnings (not throws) for mismatches — per §6.3 graceful degradation.
 *
 * Design reference: docs/ARCHITECTURE.md §3, §4.2, §6
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import semver from "semver";
function normalizeMaxVersion(maxVersion) {
    // "0.10.x" means the full 0.10 minor series is valid; exclusive upper bound is 0.11.0
    if (maxVersion.endsWith(".x")) {
        const base = maxVersion.slice(0, -2);
        const parts = base.split(".");
        const minor = parseInt(parts[1] ?? "0", 10);
        return `${parts[0]}.${minor + 1}.0`;
    }
    return maxVersion;
}
// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Read the vendored Squad version from squad/VERSION and package.json squad metadata.
 * squad/VERSION is the authoritative pinned version; package.json holds the range.
 */
export async function readVendoredVersion(teamRoot) {
    const versionFilePath = path.join(teamRoot, "squad", "VERSION");
    const packageJsonPath = path.join(teamRoot, "package.json");
    const [versionFileContent, packageJsonContent] = await Promise.all([
        fs.readFile(versionFilePath, "utf8"),
        fs.readFile(packageJsonPath, "utf8"),
    ]);
    const version = versionFileContent.trim();
    const packageJson = JSON.parse(packageJsonContent);
    const squadMeta = packageJson.squad ?? {};
    return {
        version,
        minVersion: squadMeta.minVersion ?? "0.0.0",
        maxVersion: squadMeta.maxVersion ?? "99.99.99",
        commit: squadMeta.commit,
    };
}
/**
 * Check if a Squad version string is within the supported range (§4.2).
 * Range: >= minVersion and < maxVersion (maxVersion normalised from "0.10.x" → "0.10.0").
 */
export function checkCompatibility(upstreamVersion, meta) {
    const normalised = semver.valid(semver.coerce(upstreamVersion));
    if (!normalised) {
        return {
            compatible: false,
            reason: `Upstream version "${upstreamVersion}" is not valid semver`,
            vendoredVersion: meta.version,
            requestedVersion: upstreamVersion,
        };
    }
    const maxNorm = normalizeMaxVersion(meta.maxVersion);
    const range = `>=${meta.minVersion} <${maxNorm}`;
    const compatible = semver.satisfies(normalised, range);
    return {
        compatible,
        reason: compatible
            ? undefined
            : `Squad ${upstreamVersion} is outside the supported range [${meta.minVersion}, ${meta.maxVersion})`,
        vendoredVersion: meta.version,
        requestedVersion: upstreamVersion,
    };
}
/**
 * Runtime compatibility check — reads the vendored version and compares it
 * against the package.json range. Emits a console warning on mismatch.
 */
export async function runCompatibilityCheck(teamRoot) {
    const meta = await readVendoredVersion(teamRoot);
    const result = checkCompatibility(meta.version, meta);
    if (!result.compatible) {
        console.warn(`[pi-squad] Version compatibility warning: ${result.reason ?? "unknown mismatch"}. ` +
            `Vendored: ${meta.version}, range: >=${meta.minVersion} <${meta.maxVersion}. ` +
            `Proceeding with best-effort compatibility.`);
    }
    return result;
}
//# sourceMappingURL=version.js.map