/**
 * @module context/ingestion/docling
 * Docling bridge — converts documents to markdown via subprocess call.
 *
 * Docling (https://www.docling.ai/, IBM, MIT license) is a Python library that
 * converts PDFs, Word docs, HTML, images, and more to structured markdown or JSON.
 * It runs 100% locally with no cloud API calls.
 *
 * Since pi-squad is TypeScript, we bridge Docling via a child_process shell-out:
 *   python3 -m docling <filePath>
 *
 * Graceful fallback hierarchy:
 *   1. Docling via `python3 -m docling` (if available)
 *   2. Docling via `docling convert` CLI (if installed as standalone command)
 *   3. Plain fs.readFile for .txt and .md files
 *   4. Warning + empty string for binary formats without Docling
 *
 * Extension must function without Docling installed — only rich document conversion
 * is degraded. Plain text and markdown files always work via fs.readFile fallback.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Extensions that can be read directly without Docling
const PLAIN_TEXT_EXTENSIONS = new Set([".md", ".txt", ".markdown", ".rst", ".csv"]);

// Extensions that require Docling for meaningful content extraction
const BINARY_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".doc",
  ".pptx",
  ".ppt",
  ".xlsx",
  ".xls",
  ".html",
  ".htm",
  ".png",
  ".jpg",
  ".jpeg",
  ".tiff",
]);

// Cache the availability check result to avoid repeated subprocess spawns
let doclingAvailableCache: boolean | null = null;

/**
 * Check whether Docling is available in the current environment.
 * Tries `python3 -m docling --help` first, then `docling --help` CLI.
 * Result is cached after the first call.
 *
 * @returns true if Docling can be invoked, false otherwise
 */
export async function isDoclingAvailable(): Promise<boolean> {
  if (doclingAvailableCache !== null) {
    return doclingAvailableCache;
  }

  // Try python module form first
  const moduleAvailable = await probeCommand("python3", ["-m", "docling", "--help"]);
  if (moduleAvailable) {
    doclingAvailableCache = true;
    return true;
  }

  // Try standalone CLI
  const cliAvailable = await probeCommand("docling", ["--help"]);
  doclingAvailableCache = cliAvailable;
  return cliAvailable;
}

/**
 * Convert a document to markdown using Docling.
 *
 * Attempts conversion via `python3 -m docling {filePath}` then `docling convert`.
 * Falls back to plain fs.readFile for .txt / .md when Docling is unavailable.
 * Emits a console.warn (not a throw) for binary files without Docling.
 *
 * @param filePath Absolute path to the document to convert
 * @returns Markdown string (may be empty string on unrecoverable failure)
 */
export async function convertDocument(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  const doclingAvailable = await isDoclingAvailable();

  if (doclingAvailable) {
    return runDocling(filePath);
  }

  // Graceful fallback for plain text formats
  if (PLAIN_TEXT_EXTENSIONS.has(ext)) {
    const content = await readFile(filePath, "utf-8");
    return content;
  }

  // Binary format without Docling — warn and return empty
  if (BINARY_EXTENSIONS.has(ext)) {
    console.warn(
      `[pi-squad/ingestion] Docling is not installed. Cannot extract text from ${filePath}. ` +
        `Install Docling for rich document support: pip install docling`,
    );
    return "";
  }

  // Unknown extension — attempt plain text read
  try {
    const content = await readFile(filePath, "utf-8");
    return content;
  } catch {
    console.warn(
      `[pi-squad/ingestion] Cannot read ${filePath} as text and Docling is not available.`,
    );
    return "";
  }
}

/**
 * Reset the Docling availability cache.
 * Useful in tests or after installing Docling mid-session.
 */
export function resetDoclingAvailabilityCache(): void {
  doclingAvailableCache = null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function runDocling(filePath: string): Promise<string> {
  // Try python module form first (preferred — works with virtual envs)
  try {
    const { stdout } = await execFileAsync("python3", ["-m", "docling", filePath], {
      maxBuffer: 50 * 1024 * 1024, // 50 MB — PDFs can be large
      timeout: 120_000,             // 2 min — first run downloads model weights
    });
    return stdout.trim();
  } catch (moduleErr) {
    // Fall through to CLI form
  }

  // Try standalone CLI
  try {
    const { stdout } = await execFileAsync("docling", ["convert", filePath], {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 120_000,
    });
    return stdout.trim();
  } catch (cliErr) {
    const message = cliErr instanceof Error ? cliErr.message : String(cliErr);
    console.warn(`[pi-squad/ingestion] Docling conversion failed for ${filePath}: ${message}`);
    return "";
  }
}

async function probeCommand(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
