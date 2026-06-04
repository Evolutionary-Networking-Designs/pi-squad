/**
 * @module commands/session
 *
 * Type definitions for the `/session` command interface.
 *
 * The `/session` command provides browse + resume UX for Squad sessions,
 * replacing `--resume` CLI flags. Session data is backed by `TokenAnalytics`
 * from the context monitoring subsystem (sqlite-rag persistence).
 *
 * Design reference: docs/ARCHITECTURE.md, decisions.md "session resume via
 * /session command" directive.
 * Implementation: Batou — these are interfaces only.
 */

import type { ContextPressureLevel } from "../context/types.js";

// ─── Session Entry ────────────────────────────────────────────────────────────

/**
 * A single session record as presented in the `/session` menu.
 * Aggregated from `TokenAnalytics.listSessions()` + checkpoint metadata.
 */
export interface SessionEntry {
  /** Unique session identifier (Pi session ID) */
  readonly id: string;
  /** Human-readable session name (user-assigned or auto-generated) */
  readonly name: string;
  /** When this session was last active */
  readonly lastActive: Date;
  /** Peak token count observed in this session (null if never measured) */
  readonly tokenHighWaterMark: number | null;
  /** Last known pressure level for this session */
  readonly pressureLevel: ContextPressureLevel;
  /** Brief summary of session work (from checkpoint or Scribe) */
  readonly summary: string | null;
  /** Number of checkpoints saved for this session */
  readonly checkpointCount: number;
}

// ─── Session Menu Options ─────────────────────────────────────────────────────

/**
 * Configuration for how the session list is filtered and sorted.
 */
export interface SessionMenuOptions {
  /** Optional predicate to filter which sessions appear in the menu */
  readonly filter?: (entry: SessionEntry) => boolean;
  /** Sort order for the session list (default: 'lastActive') */
  readonly sortBy?: "lastActive" | "name" | "pressure";
}

// ─── Session Command ──────────────────────────────────────────────────────────

/**
 * ExtensionCommandContext type from Pi's extension API.
 * Declared here as an import type placeholder — resolved from
 * `@earendil-works/pi-coding-agent` at build time.
 */
export interface ExtensionCommandContext {
  /** Whether the current Pi runtime supports TUI (interactive terminal UI) */
  readonly hasUI: boolean;
  /** Trigger Pi hot-reload after changes (e.g., post squad-update) */
  reload(): Promise<void>;
}

/**
 * The `/session` command interface.
 * Provides session browse, resume, and delete operations.
 */
export interface SessionCommand {
  /**
   * List available sessions, optionally filtered and sorted.
   * Data sourced from TokenAnalytics + checkpoint store.
   */
  listSessions(opts?: SessionMenuOptions): Promise<SessionEntry[]>;

  /**
   * Resume a previously checkpointed session.
   * Loads the latest checkpoint for the given session ID and triggers
   * Pi's session restore flow (re-injects coordinator state).
   * @param id - Session identifier to resume
   */
  resumeSession(id: string): Promise<void>;

  /**
   * Delete a session and all its associated checkpoints.
   * Destructive — removes from sqlite-rag and checkpoint store.
   * @param id - Session identifier to delete
   */
  deleteSession(id: string): Promise<void>;

  /**
   * Pi `registerCommand` handler for `/session`.
   * If `ctx.hasUI` is true, shows an interactive TUI picker for session
   * selection. Otherwise, falls back to a numbered list + prompt workflow.
   * @param ctx - Pi extension command context
   */
  handler(ctx: ExtensionCommandContext): Promise<void>;
}
