/**
 * @module context/ingestion/knowledge-dir
 * Knowledge directory management for the drop-folder ingestion pattern.
 *
 * Convention: `.squad/knowledge/` is the user-facing drop folder.
 * Drop any document here (PDF, Word, HTML, .md, .txt) and pi-squad will
 * auto-ingest it at session start.
 *
 * Manifest: `.squad/knowledge/.ingested` — newline-delimited list of
 * already-ingested file paths. Git-ignored by default (see .gitignore).
 *
 * Usage:
 * ```typescript
 * initKnowledgeDir(teamRoot);
 * const newFiles = await scanKnowledgeDir(teamRoot);
 * // ingest newFiles...
 * for (const f of newFiles) markIngested(f);
 * ```
 */

import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, extname, resolve } from "node:path";

const KNOWLEDGE_DIR_NAME = "knowledge";
const INGESTED_MANIFEST = ".ingested";
const GITIGNORE_NAME = ".gitignore";

// Extensions eligible for ingestion
const INGESTIBLE_EXTENSIONS = new Set([
  ".md", ".txt", ".markdown", ".rst",
  ".pdf", ".docx", ".doc", ".pptx", ".ppt",
  ".html", ".htm",
]);

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Ensure `.squad/knowledge/` exists and contains a properly-configured
 * `.gitignore` that ignores binary files (PDFs, Word docs, etc.) while
 * allowing markdown and text files to be committed.
 *
 * Safe to call on every session start — idempotent.
 *
 * @param teamRoot Absolute path to the `.squad/` parent directory (repo root)
 */
export function initKnowledgeDir(teamRoot: string): void {
  const knowledgeDir = resolveKnowledgeDir(teamRoot);
  mkdirSync(knowledgeDir, { recursive: true });

  const gitignorePath = join(knowledgeDir, GITIGNORE_NAME);
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, KNOWLEDGE_DIR_GITIGNORE, "utf-8");
  }

  const manifestPath = join(knowledgeDir, INGESTED_MANIFEST);
  if (!existsSync(manifestPath)) {
    writeFileSync(manifestPath, "", "utf-8");
  }
}

/**
 * Scan `.squad/knowledge/` for files that have not yet been ingested.
 * Compares the directory listing against the `.ingested` manifest.
 *
 * @param teamRoot Absolute path to the `.squad/` parent directory (repo root)
 * @returns Absolute paths of files not yet recorded in the manifest
 */
export async function scanKnowledgeDir(teamRoot: string): Promise<string[]> {
  const knowledgeDir = resolveKnowledgeDir(teamRoot);

  if (!existsSync(knowledgeDir)) return [];

  const ingested = loadManifest(knowledgeDir);

  let entries: string[];
  try {
    entries = await readdir(knowledgeDir);
  } catch {
    return [];
  }

  const eligible: string[] = [];

  for (const entry of entries) {
    // Skip manifest and gitignore — they're not documents
    if (entry === INGESTED_MANIFEST || entry === GITIGNORE_NAME) continue;

    const ext = extname(entry).toLowerCase();
    if (!INGESTIBLE_EXTENSIONS.has(ext)) continue;

    const absolutePath = resolve(join(knowledgeDir, entry));

    try {
      const stats = await stat(absolutePath);
      if (!stats.isFile()) continue;
    } catch {
      continue;
    }

    if (!ingested.has(absolutePath)) {
      eligible.push(absolutePath);
    }
  }

  return eligible;
}

/**
 * Mark a file as ingested by appending its path to the `.ingested` manifest.
 * Subsequent calls to `scanKnowledgeDir` will not return this file.
 *
 * @param teamRoot Absolute path to the `.squad/` parent directory (repo root)
 * @param filePath Absolute path of the file to mark as ingested
 */
export function markIngested(teamRoot: string, filePath: string): void {
  const knowledgeDir = resolveKnowledgeDir(teamRoot);
  const manifestPath = join(knowledgeDir, INGESTED_MANIFEST);
  appendFileSync(manifestPath, `${resolve(filePath)}\n`, "utf-8");
}

/**
 * Resolve the absolute path to `.squad/knowledge/`.
 *
 * @param teamRoot Absolute path to the `.squad/` parent directory (repo root)
 */
export function resolveKnowledgeDir(teamRoot: string): string {
  return join(resolve(teamRoot), ".squad", KNOWLEDGE_DIR_NAME);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function loadManifest(knowledgeDir: string): Set<string> {
  const manifestPath = join(knowledgeDir, INGESTED_MANIFEST);
  if (!existsSync(manifestPath)) return new Set();

  try {
    const content = readFileSync(manifestPath, "utf-8");
    const paths = content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    return new Set(paths);
  } catch {
    return new Set();
  }
}

// ─── .gitignore content ───────────────────────────────────────────────────────

const KNOWLEDGE_DIR_GITIGNORE = `# pi-squad knowledge directory
# Markdown and plain text files are committed (documentation as code).
# Binary formats (PDFs, Word docs, etc.) are git-ignored by default
# to keep the repo lightweight. Add explicit !exceptions if needed.

*.pdf
*.doc
*.docx
*.ppt
*.pptx
*.xls
*.xlsx
*.png
*.jpg
*.jpeg
*.tiff
*.tif

# Ingestion manifest — local state, not for commit
.ingested
`;
