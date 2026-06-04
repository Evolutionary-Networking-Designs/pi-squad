/**
 * @module scribe/drop-box
 * Drop-box file pattern utilities for the Squad inbox.
 */

import { readFile, writeFile, unlink, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";

function inboxDir(teamRoot: string): string {
  return join(teamRoot, ".squad", "decisions", "inbox");
}

/**
 * Write a decision to the inbox.
 * Returns the path written to: {teamRoot}/.squad/decisions/inbox/{agentName}-{slug}.md
 */
export async function writeToInbox(
  teamRoot: string,
  agentName: string,
  slug: string,
  content: string,
): Promise<string> {
  const dir = inboxDir(teamRoot);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${agentName}-${slug}.md`);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

/**
 * List all inbox files (full paths).
 */
export async function listInbox(teamRoot: string): Promise<string[]> {
  const dir = inboxDir(teamRoot);
  try {
    const entries = await readdir(dir);
    return entries
      .filter((e) => e.endsWith(".md"))
      .map((e) => join(dir, e));
  } catch {
    return [];
  }
}

/**
 * Read and delete an inbox file (for Scribe to merge).
 * Returns the file content.
 */
export async function consumeInboxFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, "utf8");
  await unlink(filePath);
  return content;
}

