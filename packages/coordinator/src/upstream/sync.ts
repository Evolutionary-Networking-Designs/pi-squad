/**
 * @module upstream/sync
 *
 * Upstream Squad sync helpers used by maintainer tooling.
 * The actual sync flow is managed through git submodule operations; this module
 * only checks GitHub releases for newer upstream versions.
 *
 * Design reference: docs/ARCHITECTURE.md §4.1
 */

import semver from "semver";

/**
 * Check GitHub releases for a newer Squad version without modifying the submodule.
 * Returns { available: false, latestVersion: currentVersion } on any network error.
 */
export async function checkForUpdates(
  currentVersion: string,
): Promise<{ available: boolean; latestVersion: string }> {
  try {
    const response = await fetch(
      "https://api.github.com/repos/bradygaster/squad/releases/latest",
      { headers: { "user-agent": "pi-squad-check-version" } },
    );
    if (!response.ok) {
      return { available: false, latestVersion: currentVersion };
    }
    const data = (await response.json()) as { tag_name?: string };
    const rawTag = data.tag_name ?? "";
    const latestVersion = semver.valid(semver.coerce(rawTag)) ?? currentVersion;
    const available =
      semver.valid(currentVersion) !== null &&
      semver.gt(latestVersion, currentVersion);
    return { available, latestVersion };
  } catch {
    return { available: false, latestVersion: currentVersion };
  }
}
