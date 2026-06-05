import type { Workspace } from "@jmfederico/pi-web/plugin-api";
import type { DirectoryEntry } from "./squad-reader.js";

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function readWorkspaceText(
  workspace: Pick<Workspace, "id" | "projectId">,
  filePath: string,
): Promise<string | null> {
  try {
    const response = await fetch(workspaceApiUrl(workspace, "file", filePath), { cache: "no-store" });
    if (!response.ok) return null;

    const payload = await response.json() as { binary?: boolean; content?: unknown };
    if (payload.binary || typeof payload.content !== "string") return null;
    return payload.content;
  } catch {
    return null;
  }
}

export async function listWorkspaceDirectory(
  workspace: Pick<Workspace, "id" | "projectId">,
  directoryPath: string,
): Promise<DirectoryEntry[]> {
  try {
    const response = await fetch(workspaceApiUrl(workspace, "tree", directoryPath), { cache: "no-store" });
    if (!response.ok) return [];

    const payload = await response.json() as { entries?: unknown };
    if (!Array.isArray(payload.entries)) return [];

    return payload.entries.flatMap((entry) => {
      if (!isDirectoryEntry(entry)) return [];
      return [{
        name: entry.name,
        path: entry.path,
        type: entry.type,
        modifiedAt: typeof entry.modifiedAt === "string" ? entry.modifiedAt : undefined,
      } satisfies DirectoryEntry];
    });
  } catch {
    return [];
  }
}

export function requestHostRender(host?: { requestRender?: () => void }): void {
  host?.requestRender?.();
}

function workspaceApiUrl(
  workspace: Pick<Workspace, "id" | "projectId">,
  endpoint: "file" | "tree",
  path: string,
): string {
  return `/api/projects/${encodeURIComponent(workspace.projectId)}`
    + `/workspaces/${encodeURIComponent(workspace.id)}`
    + `/${endpoint}?path=${encodeURIComponent(path)}`;
}

function isDirectoryEntry(value: unknown): value is {
  name: string;
  path: string;
  type: DirectoryEntry["type"];
  modifiedAt?: string;
} {
  if (typeof value !== "object" || value === null) return false;

  const entry = value as Record<string, unknown>;
  return typeof entry.name === "string"
    && typeof entry.path === "string"
    && (entry.type === "file" || entry.type === "directory" || entry.type === "symlink");
}
