import { promises as fs } from "node:fs";
import path from "node:path";
import type { DatabaseStore } from "../database/repositories";
import { extractSymbols, scanRepository, FileIndexEntry } from "./repository";
import { extractImports, resolveImportPath } from "./imports";
import { collectGitContext } from "./git-context";

export type IndexProgress = {
  phase: "scan" | "symbols" | "imports" | "git" | "done";
  processed: number;
  total?: number;
  currentPath?: string;
};

export type IndexResult = {
  files: number;
  indexed: number;
  removed: number;
  durationMs: number;
  gitTracked: number;
};

/**
 * Phase 4 repository index.
 *
 * Guarantees:
 *   * incremental — a file is only re-parsed when its size, mtime or hash
 *     changed; deleted files are reconciled out of the index;
 *   * symbol + import + git metadata are stored so search and context assembly
 *     never have to rescan the repository;
 *   * cancellable and bounded — callers can pass an AbortSignal and progress
 *     callbacks, and a failed file never aborts the whole index.
 */
export class RepositoryIndexService {
  private running = new Map<string, Promise<IndexResult>>();

  constructor(private readonly store: DatabaseStore) {}

  isIndexing(workspace: string) {
    return this.running.has(workspace);
  }

  /** Coalesces concurrent index requests for the same workspace. */
  index(
    workspace: string,
    onProgress?: (progress: IndexProgress) => void,
    signal?: AbortSignal,
  ): Promise<IndexResult> {
    const active = this.running.get(workspace);
    if (active) return active;
    const run = this.runIndex(workspace, onProgress, signal).finally(() => {
      this.running.delete(workspace);
    });
    this.running.set(workspace, run);
    return run;
  }

  private async runIndex(
    workspace: string,
    onProgress?: (progress: IndexProgress) => void,
    signal?: AbortSignal,
  ): Promise<IndexResult> {
    const started = Date.now();
    const previous = new Map(
      this.store.indexedFiles(workspace).map((entry) => [entry.path, entry]),
    );
    const scanned = await scanRepository(workspace, (processed, currentPath) =>
      onProgress?.({ phase: "scan", processed, currentPath }),
    );
    const currentPaths = new Set(scanned.map((entry) => entry.path));
    const removed = [...previous.keys()].filter(
      (file) => !currentPaths.has(file),
    );
    this.store.removeMissingFiles(workspace, removed);
    this.store.markIndexed(workspace);

    const allPaths = new Set(scanned.map((entry) => entry.path));
    let indexed = 0;
    for (const entry of scanned) {
      if (signal?.aborted) break;
      const old = previous.get(entry.path);
      const unchanged =
        old?.hash === entry.hash &&
        old.size === entry.size &&
        old.modifiedTime === entry.modifiedTime;
      if (unchanged) continue;
      const fullPath = path.join(workspace, entry.path);
      const content = await fs.readFile(fullPath, "utf8").catch(() => "");
      this.store.replaceSymbols(
        workspace,
        entry.path,
        extractSymbols(content, entry.path),
      );
      onProgress?.({
        phase: "symbols",
        processed: indexed,
        currentPath: entry.path,
      });
      const imports = extractImports(content, entry.path).map(
        (entryImport) => ({
          module: entryImport.module,
          kind: entryImport.kind,
          line: entryImport.line,
          resolvedPath: resolveImportPath(
            entry.path,
            entryImport.module,
            allPaths,
          ),
          names: entryImport.names,
        }),
      );
      this.store.replaceImports(workspace, entry.path, imports);
      onProgress?.({
        phase: "imports",
        processed: indexed,
        currentPath: entry.path,
      });
      indexed += 1;
    }
    this.store.replaceFileIndex(workspace, scanned);

    // Git metadata last: it is a single bounded pair of git invocations.
    let gitTracked = 0;
    try {
      const git = await collectGitContext(workspace);
      if (git.isRepo) {
        const byPath = new Map(git.files.map((file) => [file.path, file]));
        const entries = scanned.map((entry) => {
          const info = byPath.get(entry.path);
          return {
            path: entry.path,
            status: info?.status ?? "clean",
            lastCommit: info?.lastCommit ?? null,
            lastCommitAt: info?.lastCommitAt ?? null,
            lastCommitSubject: info?.lastCommitSubject ?? null,
          };
        });
        this.store.replaceFileGitMeta(workspace, entries);
        gitTracked = git.files.length;
      }
    } catch {
      // Not a git repository, or git is unavailable: the index is still valid.
    }
    onProgress?.({ phase: "done", processed: scanned.length });

    return {
      files: scanned.length,
      indexed,
      removed: removed.length,
      durationMs: Date.now() - started,
      gitTracked,
    };
  }

  /**
   * Index only the given paths (watcher-driven incremental updates). Missing
   * paths are removed from the index.
   */
  async indexPaths(
    workspace: string,
    paths: string[],
    signal?: AbortSignal,
  ): Promise<IndexResult> {
    const started = Date.now();
    const allPaths = new Set(
      this.store.indexedFiles(workspace).map((e) => e.path),
    );
    let indexed = 0;
    const missing: string[] = [];
    for (const relative of paths) {
      if (signal?.aborted) break;
      const full = path.join(workspace, relative);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat || !stat.isFile()) {
        missing.push(relative);
        allPaths.delete(relative);
        continue;
      }
      if (stat.size > 2 * 1024 * 1024) continue;
      const content = await fs.readFile(full).catch(() => null);
      if (!content || content.subarray(0, 8192).includes(0)) continue;
      allPaths.add(relative);
      this.store.replaceFileIndex(workspace, [
        {
          path: relative,
          language: languageOf(relative),
          size: stat.size,
          modifiedTime: stat.mtime.toISOString(),
          hash: hashOf(content),
        },
      ]);
      const text = content.toString("utf8");
      this.store.replaceSymbols(
        workspace,
        relative,
        extractSymbols(text, relative),
      );
      this.store.replaceImports(
        workspace,
        relative,
        extractImports(text, relative).map((entry) => ({
          module: entry.module,
          kind: entry.kind,
          line: entry.line,
          resolvedPath: resolveImportPath(relative, entry.module, allPaths),
          names: entry.names,
        })),
      );
      indexed += 1;
    }
    if (missing.length) this.store.removeMissingFiles(workspace, missing);
    this.store.markIndexed(workspace);
    return {
      files: indexed,
      indexed,
      removed: missing.length,
      durationMs: Date.now() - started,
      gitTracked: 0,
    };
  }
}

function languageOf(filePath: string): string {
  const extension = path.extname(filePath).slice(1);
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    java: "java",
    go: "go",
    rs: "rust",
    c: "c",
    cpp: "cpp",
    h: "c",
    md: "markdown",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
  };
  return map[extension] ?? "text";
}

function hashOf(content: Buffer): string {
  // Lazy import keeps this module free of a crypto import cycle in tests.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(content).digest("hex");
}

export type { FileIndexEntry };
