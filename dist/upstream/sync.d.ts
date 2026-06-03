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
export interface SyncOptions {
    /** Target Squad version (e.g., "0.9.5") */
    version: string;
    /** Where to extract vendored source (e.g., "squad/") */
    targetDir: string;
    /** Dry-run — check but don't modify */
    checkOnly?: boolean;
}
export interface SyncResult {
    previousVersion: string;
    newVersion: string;
    filesChanged: number;
    compatible: boolean;
}
/**
 * Check GitHub releases for a newer Squad version without downloading.
 * Returns { available: false, latestVersion: currentVersion } on any network error.
 */
export declare function checkForUpdates(currentVersion: string): Promise<{
    available: boolean;
    latestVersion: string;
}>;
/**
 * Download Squad at the requested version and extract it into options.targetDir.
 * When checkOnly is true, validates the version range but makes no filesystem changes.
 *
 * Uses a temporary work directory adjacent to targetDir for staging.
 * Cleans up the work directory on success or failure.
 */
export declare function syncSquadUpstream(options: SyncOptions): Promise<SyncResult>;
//# sourceMappingURL=sync.d.ts.map