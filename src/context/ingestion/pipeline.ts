/**
 * @module context/ingestion/pipeline
 * Docling ingestion pipeline — convert → sanitize → chunk → embed → store.
 *
 * The pipeline is dependency-injected:
 *   - `backend`: VectorBackend (sqlite-vec or pgvector)
 *   - `embedFn`: async text → Float32Array(384) (from @huggingface/transformers)
 *
 * Sanitization is a HARD GATE: no raw content may be embedded without passing
 * through the sanitizer. The sourceType parameter controls sanitization intensity
 * ('document' for local files, 'web' for untrusted external content).
 *
 * This keeps the pipeline decoupled from storage and embedding implementations.
 * The coordinator wires these dependencies at startup.
 *
 * Usage:
 * ```typescript
 * const pipeline = createIngestionPipeline(backend, embedFn);
 * await pipeline.ingestDocument("/path/to/doc.pdf");
 * await pipeline.ingestDirectory(".squad/knowledge/");
 * pipeline.watchKnowledgeDir(".squad/knowledge/");
 * ```
 */

import { readdir, stat } from "node:fs/promises";
import { watch } from "node:fs";
import { join, extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { convertDocument } from "./docling.js";
import { chunkMarkdown } from "./chunker.js";
import { sanitize } from "./sanitizer.js";
import type { SourceType } from "./sanitizer.js";
import type { DocMetadata, IngestResult, IngestFileResult, ChunkOptions, IngestProgressCallback } from "./types.js";
import type { VectorBackend } from "../backends/types.js";

// Extensions we attempt to ingest
const INGESTIBLE_EXTENSIONS = new Set([
  ".md", ".txt", ".markdown", ".rst",
  ".pdf", ".docx", ".doc", ".pptx", ".ppt",
  ".html", ".htm",
]);

// ─── Pipeline Interface ───────────────────────────────────────────────────────

export interface IngestionPipeline {
  /**
   * Ingest a single document: convert → chunk → embed → store.
   * Returns the embedding IDs of stored chunks.
   *
   * @param filePath Absolute path to the document
   * @param metadata Optional metadata to attach (chunkIndex/totalChunks set automatically)
   * @param options  Chunking options
   * @returns IDs of stored chunk embeddings
   */
  ingestDocument(
    filePath: string,
    metadata?: Partial<DocMetadata>,
    options?: ChunkOptions,
  ): Promise<string[]>;

  /**
   * Batch-ingest all eligible files in a directory.
   * Files are filtered by supported extension. Subdirectories are NOT traversed.
   *
   * @param dirPath  Absolute path to directory
   * @param glob     Optional extension filter (e.g. '*.md') — simple suffix match only
   * @param onProgress Optional callback invoked after each file
   * @returns Aggregate ingestion result
   */
  ingestDirectory(
    dirPath: string,
    glob?: string,
    onProgress?: IngestProgressCallback,
  ): Promise<IngestResult>;

  /**
   * Watch a directory for new or changed files and auto-ingest them.
   * Uses Node.js fs.watch — no external dependencies.
   * Fires on 'rename' (new file) and 'change' (modified file).
   *
   * Call the returned function to stop watching.
   *
   * @param knowledgeDir Absolute path to watch
   * @returns stop function — call to remove the watcher
   */
  watchKnowledgeDir(knowledgeDir: string): () => void;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a configured IngestionPipeline.
 *
 * @param backend    VectorBackend — must already be initialized
 * @param embedFn    Async function that embeds a text string into Float32Array(384)
 * @param sourceType Content origin for sanitization — 'document' (default) or 'web'
 */
export function createIngestionPipeline(
  backend: VectorBackend,
  embedFn: (text: string) => Promise<Float32Array>,
  sourceType: SourceType = 'document',
): IngestionPipeline {
  return {
    async ingestDocument(
      filePath: string,
      metadata?: Partial<DocMetadata>,
      options?: ChunkOptions,
    ): Promise<string[]> {
      const absolutePath = resolve(filePath);
      const markdown = await convertDocument(absolutePath);

      if (!markdown.trim()) {
        return [];
      }

      // ── Sanitization hard gate ────────────────────────────────────────────────
      // No content may reach the embedder without passing sanitization.
      let sanitized: string;
      try {
        const result = sanitize(markdown, { sourceType });
        if (result.truncated || result.issuesFound.length > 0) {
          console.warn(
            `[pi-squad/sanitizer] ${absolutePath}: ${result.issuesFound.join(', ')}`,
          );
        }
        sanitized = result.text;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`[pi-squad/sanitizer] Sanitization failed for ${absolutePath}: ${message}`);
      }

      if (!sanitized.trim()) {
        return [];
      }

      const chunks = chunkMarkdown(sanitized, options);
      if (chunks.length === 0) return [];

      const now = new Date().toISOString();
      const storedIds: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (!chunk.trim()) continue;

        const embedding = await embedFn(chunk);
        const id = `chunk:${absolutePath}:${i}:${randomUUID().slice(0, 8)}`;

        const chunkMeta: DocMetadata = {
          sourcePath: absolutePath,
          mimeType: inferMimeType(absolutePath),
          ingestedAt: now,
          title: metadata?.title,
          tags: metadata?.tags,
          ...metadata,
          // These are always pipeline-managed — override any caller-provided values
          chunkIndex: i,
          totalChunks: chunks.length,
        };

        await backend.saveEmbedding(id, embedding, chunkMeta as unknown as Record<string, unknown>);
        storedIds.push(id);
      }

      return storedIds;
    },

    async ingestDirectory(
      dirPath: string,
      glob?: string,
      onProgress?: IngestProgressCallback,
    ): Promise<IngestResult> {
      const absoluteDir = resolve(dirPath);
      let entries: string[];

      try {
        entries = await readdir(absoluteDir);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          succeeded: 0,
          failed: 0,
          totalChunksStored: 0,
          files: [{ filePath: absoluteDir, success: false, chunksStored: 0, error: message }],
        };
      }

      // Filter to ingestible files (no subdirectory traversal by design)
      const eligible = entries.filter((entry) => {
        const ext = extname(entry).toLowerCase();
        const matchesGlob = !glob || entry.endsWith(glob.replace(/^\*/, ""));
        return INGESTIBLE_EXTENSIONS.has(ext) && matchesGlob;
      });

      const results: IngestFileResult[] = [];
      let succeeded = 0;
      let failed = 0;
      let totalChunksStored = 0;

      for (let i = 0; i < eligible.length; i++) {
        const filePath = join(absoluteDir, eligible[i]);
        try {
          const ids = await this.ingestDocument(filePath);
          const fileResult: IngestFileResult = {
            filePath,
            success: true,
            chunksStored: ids.length,
          };
          results.push(fileResult);
          succeeded++;
          totalChunksStored += ids.length;
          onProgress?.(fileResult, i, eligible.length);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const fileResult: IngestFileResult = {
            filePath,
            success: false,
            chunksStored: 0,
            error: message,
          };
          results.push(fileResult);
          failed++;
          onProgress?.(fileResult, i, eligible.length);
        }
      }

      return { succeeded, failed, totalChunksStored, files: results };
    },

    watchKnowledgeDir(knowledgeDir: string): () => void {
      const absoluteDir = resolve(knowledgeDir);
      const self = this;

      // Debounce to avoid duplicate events on rapid writes
      const debounceMs = 500;
      const pending = new Map<string, ReturnType<typeof setTimeout>>();

      const watcher = watch(absoluteDir, (eventType, filename) => {
        if (!filename) return;

        const ext = extname(filename).toLowerCase();
        if (!INGESTIBLE_EXTENSIONS.has(ext)) return;

        // Clear any pending debounce for this file
        const existing = pending.get(filename);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(async () => {
          pending.delete(filename);
          const filePath = join(absoluteDir, filename);

          try {
            const stats = await stat(filePath);
            if (!stats.isFile()) return;
          } catch {
            return; // File deleted or inaccessible
          }

          try {
            const ids = await self.ingestDocument(filePath);
            if (ids.length > 0) {
              console.log(
                `[pi-squad/ingestion] Auto-ingested ${filename}: ${ids.length} chunk(s) stored`,
              );
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[pi-squad/ingestion] Failed to auto-ingest ${filename}: ${message}`);
          }
        }, debounceMs);

        pending.set(filename, timer);
      });

      return () => {
        watcher.close();
        for (const timer of pending.values()) clearTimeout(timer);
        pending.clear();
      };
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".txt": "text/plain",
    ".rst": "text/plain",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".ppt": "application/vnd.ms-powerpoint",
    ".html": "text/html",
    ".htm": "text/html",
  };
  return mimeMap[ext] ?? "application/octet-stream";
}
