import path from "node:path";

import type { DirectoryEntry } from "../../src/squad-reader.js";

export interface MockIo {
  files: Map<string, string>;
  directories: Map<string, Map<string, string>>;
  readTextFileSafe: (filePath: string) => Promise<string | null>;
  listDirectorySafe: (directoryPath: string) => Promise<DirectoryEntry[]>;
}

export interface MockIoOptions {
  files?: Map<string, string>;
  directories?: Map<string, Map<string, string>>;
  modifiedAtByPath?: Map<string, string>;
}

export function createMockIo(options: MockIoOptions = {}): MockIo {
  const files = cloneFileMap(options.files);
  const directories = cloneDirectoryMap(options.directories);
  const modifiedAtByPath = cloneFileMap(options.modifiedAtByPath);

  return {
    files,
    directories,
    async readTextFileSafe(filePath: string): Promise<string | null> {
      return files.get(normalizePath(filePath)) ?? null;
    },
    async listDirectorySafe(directoryPath: string): Promise<DirectoryEntry[]> {
      const normalizedDirectory = normalizePath(directoryPath);
      const entries = directories.get(normalizedDirectory);
      if (entries === undefined) return [];

      return [...entries.keys()].sort().map((name) => {
        const entryPath = path.posix.join(normalizedDirectory, name);
        return {
          name,
          path: entryPath,
          type: "file",
          modifiedAt: modifiedAtByPath.get(entryPath),
        } satisfies DirectoryEntry;
      });
    },
  };
}

function cloneFileMap(source: Map<string, string> | undefined): Map<string, string> {
  return new Map([...(source ?? new Map<string, string>())].map(([key, value]) => [normalizePath(key), value]));
}

function cloneDirectoryMap(
  source: Map<string, Map<string, string>> | undefined,
): Map<string, Map<string, string>> {
  return new Map(
    [...(source ?? new Map<string, Map<string, string>>())].map(([directoryPath, entries]) => [
      normalizePath(directoryPath),
      new Map(entries),
    ]),
  );
}

function normalizePath(value: string): string {
  return path.posix.normalize(value);
}
