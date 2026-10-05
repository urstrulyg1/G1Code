import { promises as fs } from "node:fs";
import path from "node:path";
import type { DatabaseStore } from "../database/repositories";
import { collectGitContext, type GitRepositoryContext } from "./git-context";

/**
 * Phase 4 ranked repository search.
 *
 * The previous implementation had three unrelated search paths (`grep` over the
 * whole tree, a raw SQL symbol lookup, and an unwired `rankedSearch`). This is
 * the single ranked entry point used by the UI, the context engine, and the
 * agent tools. It answers questions like "where is authentication implemented?"
 * by combining:
 *
 *   * filename matches (exact > prefix > substring > path segment)
 *   * symbol matches from the persisted index (exact > prefix > substring)
 *   * dependency matches (a file that imports a matching module)
 *   * text matches found by a bounded scan of the indexed files
 *   * ranking boosts for git-modified files, recently modified files, shallow
 *     paths, and tests related to the query
 *
 * Everything is bounded: file reads are limited by count and bytes, and the
 * whole search is cancellable.
 */

export type RepositorySearchKind =
  "mixed" | "filename" | "symbol" | "text" | "recent";

export type RepositorySearchHit = {
  path: string;
  score: number;
  /** Why this file matched — surfaced in the UI and given back to the model. */
  reasons: string[];
  line?: number;
  preview?: string;
  language?: string;
  gitStatus?: string;
  lastCommit?: {
    hash: string;
    at: string;
    subject: string;
  } | null;
};

export type RepositorySearchResult = {
  query: string;
  kind: RepositorySearchKind;
  hits: RepositorySearchHit[];
  scannedFiles: number;
  truncated: boolean;
  durationMs: number;
  gitBranch?: string;
};

export type RepositorySearchOptions = {
  kind?: RepositorySearchKind;
  limit?: number;
  /** File that is currently open; used as a relevance boost. */
  contextPath?: string;
  signal?: AbortSignal;
  /** Maximum files to read for text matching. */
  maxTextFiles?: number;
  /** Maximum bytes per file to scan. */
  maxBytesPerFile?: number;
};

const TEXT_FILE_LIMIT = 250;
const TEXT_BYTES_PER_FILE = 200_000;

export class RepositorySearchService {
  private gitCache = new Map<
    string,
    { at: number; context: GitRepositoryContext }
  >();

  constructor(private readonly store: DatabaseStore) {}

  /** Cached git context (5 second TTL) so search stays cheap under typing. */
  async gitContext(
    workspace: string,
    options: { force?: boolean } = {},
  ): Promise<GitRepositoryContext> {
    const cached = this.gitCache.get(workspace);
    if (!options.force && cached && Date.now() - cached.at < 5_000) {
      return cached.context;
    }
    const context = await collectGitContext(workspace);
    this.gitCache.set(workspace, { at: Date.now(), context });
    return context;
  }

  invalidateGitCache(workspace?: string) {
    if (workspace) this.gitCache.delete(workspace);
    else this.gitCache.clear();
  }

  async search(
    workspace: string,
    query: string,
    options: RepositorySearchOptions = {},
  ): Promise<RepositorySearchResult> {
    const started = Date.now();
    const kind = options.kind ?? "mixed";
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    const trimmed = query.trim();
    const indexed = this.store.indexedFiles(workspace);
    if (!trimmed) {
      return {
        query,
        kind,
        hits: [],
        scannedFiles: 0,
        truncated: false,
        durationMs: Date.now() - started,
      };
    }

    const git = await this.gitContext(workspace);
    const gitByPath = new Map(git.files.map((file) => [file.path, file]));
    const normalized = trimmed.toLowerCase();
    const symbols = this.store.searchSymbols(workspace, trimmed) as Array<{
      symbol: string;
      kind: string;
      path: string;
      line: number;
      column: number;
      parent?: string | null;
    }>;
    const imports = this.store.searchImports(workspace, trimmed, 50);
    const importerByPath = new Map(imports.map((entry) => [entry.path, entry]));

    const scores = new Map<string, RepositorySearchHit>();
    const add = (
      filePath: string,
      score: number,
      reason: string,
      extra: Partial<RepositorySearchHit> = {},
    ) => {
      const existing = scores.get(filePath);
      if (existing) {
        existing.score += score;
        if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
        if (existing.line === undefined && extra.line !== undefined)
          existing.line = extra.line;
        if (existing.preview === undefined && extra.preview !== undefined)
          existing.preview = extra.preview;
        return;
      }
      scores.set(filePath, {
        path: filePath,
        score,
        reasons: [reason],
        ...extra,
      });
    };

    if (kind === "recent") {
      for (const file of this.store.recentIndexedFiles(workspace, limit)) {
        if (normalized && !file.path.toLowerCase().includes(normalized))
          continue;
        add(file.path, 50, "recently modified");
      }
    }

    if (kind === "mixed" || kind === "filename") {
      const querySegments = normalized.split(/[\\/.]/).filter(Boolean);
      for (const file of indexed) {
        const filePath = file.path.toLowerCase();
        const base = path.basename(filePath);
        const baseNoExt = base.replace(/\.[^.]+$/, "");
        let score = 0;
        if (baseNoExt === normalized) score += 120;
        else if (base === normalized) score += 110;
        else if (baseNoExt.startsWith(normalized)) score += 70;
        else if (base.includes(normalized)) score += 50;
        else if (filePath.includes(normalized)) score += 25;
        else if (
          querySegments.length > 1 &&
          querySegments.every((s) => filePath.includes(s))
        )
          score += 20;
        if (score > 0) add(file.path, score, "filename match");
      }
    }

    if (kind === "mixed" || kind === "symbol") {
      for (const symbol of symbols) {
        const symbolName = symbol.symbol.toLowerCase();
        let score = 0;
        if (symbolName === normalized) score += 130;
        else if (symbolName.startsWith(normalized)) score += 90;
        else score += 45;
        if (symbol.kind === "class" || symbol.kind === "function") score += 5;
        add(symbol.path, score, `symbol ${symbol.symbol} (${symbol.kind})`, {
          line: symbol.line,
        });
      }
    }

    if (kind === "mixed") {
      for (const [filePath, entry] of importerByPath) {
        add(filePath, 30, `imports "${entry.module}"`);
      }
    }

    // Text search runs only over a bounded candidate set.
    let scannedFiles = 0;
    let truncated = false;
    if (kind === "mixed" || kind === "text") {
      const maxTextFiles = options.maxTextFiles ?? TEXT_FILE_LIMIT;
      const maxBytes = options.maxBytesPerFile ?? TEXT_BYTES_PER_FILE;
      // Candidate ordering: already-scored files first (they are most likely),
      // then cheap name/path matches, then modified files.
      const candidates = [...indexed].sort((a, b) => {
        const aScore = scores.get(a.path)?.score ?? 0;
        const bScore = scores.get(b.path)?.score ?? 0;
        if (aScore !== bScore) return bScore - aScore;
        const aModified = gitByPath.has(a.path) ? 1 : 0;
        const bModified = gitByPath.has(b.path) ? 1 : 0;
        return bModified - aModified || a.path.localeCompare(b.path);
      });
      for (const file of candidates) {
        if (options.signal?.aborted) break;
        if (scannedFiles >= maxTextFiles) {
          truncated = true;
          break;
        }
        if (file.size > maxBytes) continue;
        scannedFiles += 1;
        const absolute = path.join(workspace, file.path);
        const content = await fs.readFile(absolute, "utf8").catch(() => null);
        if (content === null) continue;
        const index = content.toLowerCase().indexOf(normalized);
        if (index < 0) continue;
        const line = content.slice(0, index).split(/\r?\n/).length;
        const previewLine =
          content.split(/\r?\n/)[line - 1]?.trim().slice(0, 200) ?? "";
        add(file.path, 60, "text match", { line, preview: previewLine });
      }
    }

    const contextDir = options.contextPath
      ? path.dirname(options.contextPath)
      : undefined;
    const hits = [...scores.values()].map((hit) => {
      let score = hit.score;
      const gitInfo = gitByPath.get(hit.path);
      if (gitInfo && gitInfo.status !== "clean") score += 18;
      if (options.contextPath) {
        if (hit.path === options.contextPath) score += 40;
        else if (contextDir && path.dirname(hit.path) === contextDir)
          score += 12;
      }
      // Prefer shallower paths: deep vendor-like paths are usually noise.
      score -= Math.min(10, hit.path.split("/").length - 1);
      if (
        /(^|\/)(test|tests|__tests__|spec)\//.test(hit.path) &&
        /test|spec/i.test(trimmed)
      )
        score += 15;
      const indexedEntry = indexed.find((entry) => entry.path === hit.path);
      return {
        ...hit,
        score,
        language: indexedEntry?.language,
        gitStatus: gitInfo?.status,
        lastCommit: gitInfo?.lastCommit
          ? {
              hash: gitInfo.lastCommit,
              at: gitInfo.lastCommitAt ?? "",
              subject: gitInfo.lastCommitSubject ?? "",
            }
          : null,
      };
    });

    return {
      query: trimmed,
      kind,
      hits: hits
        .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
        .slice(0, limit),
      scannedFiles,
      truncated,
      durationMs: Date.now() - started,
      gitBranch: git.branch,
    };
  }
}
