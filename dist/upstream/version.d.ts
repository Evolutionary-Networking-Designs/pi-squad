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
export interface SquadVersionMeta {
    version: string;
    minVersion: string;
    maxVersion: string;
    commit?: string;
}
export interface CompatibilityResult {
    compatible: boolean;
    reason?: string;
    vendoredVersion: string;
    requestedVersion: string;
}
/**
 * Read the vendored Squad version from squad/VERSION and package.json squad metadata.
 * squad/VERSION is the authoritative pinned version; package.json holds the range.
 */
export declare function readVendoredVersion(teamRoot: string): Promise<SquadVersionMeta>;
/**
 * Check if a Squad version string is within the supported range (§4.2).
 * Range: >= minVersion and < maxVersion (maxVersion normalised from "0.10.x" → "0.10.0").
 */
export declare function checkCompatibility(upstreamVersion: string, meta: SquadVersionMeta): CompatibilityResult;
/**
 * Runtime compatibility check — reads the vendored version and compares it
 * against the package.json range. Emits a console warning on mismatch.
 */
export declare function runCompatibilityCheck(teamRoot: string): Promise<CompatibilityResult>;
//# sourceMappingURL=version.d.ts.map