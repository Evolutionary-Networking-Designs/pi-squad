/**
 * @module commands/squad-update
 *
 * Type definitions for the `/squad-update` command interface.
 *
 * The `/squad-update` command runs sync-squad to pull upstream Squad changes,
 * validates version compatibility, and triggers a Pi hot-reload on success.
 *
 * Design reference: docs/ARCHITECTURE.md §3 (upstream sync), §6 (version guards).
 * Implementation: Batou — these are interfaces only.
 */

import type { ExtensionCommandContext } from "./session.js";

// ─── Squad Update Command ─────────────────────────────────────────────────────

/**
 * The `/squad-update` command interface.
 * Orchestrates upstream sync, version check, and Pi reload.
 */
export interface SquadUpdateCommand {
  /**
   * Pi `registerCommand` handler for `/squad-update`.
   *
   * Execution flow:
   * 1. Runs `sync-squad` to pull latest upstream Squad source into `squad/`
   * 2. Runs `check-version` to validate compatibility against min/maxVersion
   * 3. On success: calls `ctx.reload()` to hot-reload the Pi extension
   * 4. On failure: reports the version mismatch to the user without reloading
   *
   * @param ctx - Pi extension command context (provides `reload()`)
   */
  handler(ctx: ExtensionCommandContext): Promise<void>;
}
