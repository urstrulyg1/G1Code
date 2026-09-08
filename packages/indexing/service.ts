import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { DatabaseStore } from "../database/repositories";
import { extractSymbols, fileLanguage, scanRepository, FileIndexEntry } from "./repository";

export class RepositoryIndexService {
  constructor(private readonly store: DatabaseStore) {}
  async index(workspace: string, onProgress?: (processed: number) => void) {
    const previous = new Map(this.store.indexedFiles(workspace).map((entry) => [entry.path, entry]));
    const scanned = await scanRepository(workspace, onProgress);
    const current = new Set(scanned.map((entry) => entry.path));
    this.store.removeMissingFiles(workspace, [...previous.keys()].filter((filePath) => !current.has(filePath)));
    for (const entry of scanned) {
      const old = previous.get(entry.path);
      if (old?.hash === entry.hash && old.size === entry.size && old.modifiedTime === entry.modifiedTime) continue;
      const fullPath = path.join(workspace, entry.path);
      const content = await fs.readFile(fullPath, "utf8").catch(() => "");
      this.store.replaceSymbols(workspace, entry.path, extractSymbols(content, entry.path));
    }
    this.store.replaceFileIndex(workspace, scanned);
    return scanned;
  }
}
