import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { DatabaseStore } from "../database/repositories";
import type { RepositorySearchService } from "../indexing/search-service";
import type { ContextPart } from "./budget";
import { wrapUntrusted } from "./trust";

/**
 * Phase 4 automatic context assembly.
 *
 * Before this, context was whatever the renderer happened to attach plus
 * whatever files the model chose to read. This module answers "what should the
 * model see for this request?" deterministically and observably:
 *
 *   1. the open file (selection first)
 *   2. symbols related to the request keywords
 *   3. imports/dependencies of the files above
 *   4. ranked repository search results
 *   5. git-modified files
 *   6. recently modified files
 *   7. tests related to the changed/matched files
 *   8. project configuration files
 *   9. previous session context (summary)
 *
 * Every included file is ranked, deduplicated by content hash, cut to a strict
 * character budget, and recorded in a manifest so the UI can explain exactly
 * which files were used and why.
 */

export type ContextSourceKind =
  | "open_file"
  | "selection"
  | "symbol"
  | "dependency"
  | "search"
  | "git"
  | "recent"
  | "test"
  | "config"
  | "instructions"
  | "session"
  | "attachment";

export type ContextCandidate = {
  kind: ContextSourceKind;
  /** Workspace-relative path, when this candidate is a file. */
  path?: string;
  content: string;
  /** Base priority before relevance scoring. */
  priority: number;
  reason: string;
  lineStart?: number;
  lineEnd?: number;
};

export type ContextManifestEntry = {
  path?: string;
  kind: ContextSourceKind;
  reason: string;
  chars: number;
  truncated: boolean;
  lineStart?: number;
  lineEnd?: number;
};

export type ContextManifest = {
  budgetChars: number;
  usedChars: number;
  included: ContextManifestEntry[];
  excluded: Array<{ path?: string; reason: string }>;
  timings: { assembleMs: number; searchMs: number };
};

export type AssembledContext = {
  /** The prompt block handed to the model (empty when nothing was selected). */
  text: string;
  parts: ContextPart[];
  manifest: ContextManifest;
};

export type ContextRequest = {
  workspace: string;
  prompt: string;
  openFile?: string;
  selection?: string;
  budgetChars?: number;
  sessionId?: string;
  /** Extra attachments supplied by the user (highest priority). */
  attachments?: string[];
  signal?: AbortSignal;
};

export type ContextAssemblerDeps = {
  store: DatabaseStore;
  search: RepositorySearchService;
  maxFileChars?: number;
};

const DEFAULT_BUDGET = 60_000;
const DEFAULT_MAX_FILE_CHARS = 8_000;
const MAX_FILES_PER_SOURCE = 6;
/** Per-keyword searches run in parallel; each is bounded to this many text files. */
const KEYWORD_SEARCHES = 3;
const KEYWORD_TEXT_FILE_LIMIT = 80;

/** Keywords used to drive symbol/search candidates from the prompt. */
export function contextKeywords(prompt: string, limit = 12): string[] {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "please",
    "should",
    "would",
    "could",
    "have",
    "has",
    "was",
    "were",
    "are",
    "is",
    "it",
    "in",
    "on",
    "of",
    "to",
    "a",
    "an",
    "add",
    "fix",
    "make",
    "use",
    "when",
    "where",
    "which",
    "why",
    "how",
    "does",
    "do",
    "can",
    "code",
    "file",
    "files",
    "please",
    "need",
    "want",
    "implement",
    "update",
  ]);
  const words = prompt
    .replace(/[^\p{L}\p{N}_./-]+/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !stop.has(word.toLowerCase()));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const word of words) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(word);
    if (result.length >= limit) break;
  }
  return result;
}

export class ContextAssembler {
  private readonly maxFileChars: number;

  constructor(private readonly deps: ContextAssemblerDeps) {
    this.maxFileChars = deps.maxFileChars ?? DEFAULT_MAX_FILE_CHARS;
  }

  async assemble(request: ContextRequest): Promise<AssembledContext> {
    const started = Date.now();
    const budgetChars = Math.max(
      4_000,
      Math.min(request.budgetChars ?? DEFAULT_BUDGET, 500_000),
    );
    const candidates: ContextCandidate[] = [];
    const excluded: Array<{ path?: string; reason: string }> = [];
    let searchMs = 0;

    const readFile = async (
      relative: string,
    ): Promise<{ content: string; binary: boolean } | null> => {
      try {
        const absolute = path.join(request.workspace, relative);
        const stat = await fs.stat(absolute);
        if (!stat.isFile()) return null;
        if (stat.size > 2_000_000) return { content: "", binary: true };
        const buffer = await fs.readFile(absolute);
        if (buffer.subarray(0, 8192).includes(0)) {
          return { content: "", binary: true };
        }
        // Generated/vendor content is never useful context.
        if (
          /(^|\/)(node_modules|dist|dist-electron|build|coverage|\.next|vendor|target)\//.test(
            relative,
          )
        ) {
          return { content: "", binary: true };
        }
        return { content: buffer.toString("utf8"), binary: false };
      } catch {
        return null;
      }
    };

    const addFile = async (
      kind: ContextSourceKind,
      relative: string,
      priority: number,
      reason: string,
    ) => {
      const file = await readFile(relative);
      if (!file) {
        excluded.push({ path: relative, reason: "not found" });
        return;
      }
      if (file.binary) {
        excluded.push({
          path: relative,
          reason: "binary, vendor, generated, or oversized file",
        });
        return;
      }
      candidates.push({
        kind,
        path: relative,
        priority,
        reason,
        content: file.content.slice(0, this.maxFileChars),
      });
    };

    // 1. User attachments and selection are the most specific signals.
    for (const attachment of request.attachments ?? []) {
      if (attachment.trim())
        candidates.push({
          kind: "attachment",
          priority: 100,
          reason: "attached by the user",
          content: attachment.slice(0, this.maxFileChars * 2),
        });
    }
    if (request.selection && request.selection.trim()) {
      candidates.push({
        kind: "selection",
        priority: 98,
        reason: "editor selection",
        path: request.openFile,
        content: request.selection.slice(0, this.maxFileChars),
      });
    }
    if (request.openFile) {
      await addFile("open_file", request.openFile, 95, "currently open file");
    }

    // Keywords drive every remaining source. Each keyword is searched
    // independently (a natural-language prompt is not a substring of any
    // file), then the hits are merged and re-ranked by total score.
    const keywords = contextKeywords(request.prompt);
    const searchStarted = Date.now();
    const perKeyword = await Promise.all(
      (keywords.length ? keywords.slice(0, KEYWORD_SEARCHES) : [request.prompt])
        .filter(Boolean)
        .map((keyword) =>
          this.deps.search
            .search(request.workspace, keyword, {
              limit: MAX_FILES_PER_SOURCE,
              contextPath: request.openFile,
              maxTextFiles: KEYWORD_TEXT_FILE_LIMIT,
              signal: request.signal,
            })
            .catch(() => null),
        ),
    );
    searchMs = Date.now() - searchStarted;
    const merged = new Map<string, { score: number; reasons: string[] }>();
    for (const result of perKeyword) {
      if (!result) continue;
      for (const hit of result.hits) {
        const existing = merged.get(hit.path);
        if (existing) {
          existing.score += hit.score;
          for (const reason of hit.reasons)
            if (!existing.reasons.includes(reason))
              existing.reasons.push(reason);
        } else {
          merged.set(hit.path, { score: hit.score, reasons: [...hit.reasons] });
        }
      }
    }
    const rankedHits = [...merged.entries()].sort(
      (a, b) => b[1].score - a[1].score,
    );
    for (const [hitPath, hit] of rankedHits.slice(0, MAX_FILES_PER_SOURCE)) {
      if (request.openFile && hitPath === request.openFile) continue;
      await addFile(
        hit.reasons.some((reason) => reason.startsWith("symbol"))
          ? "symbol"
          : "search",
        hitPath,
        70,
        `repository search: ${hit.reasons.slice(0, 2).join(", ")}`,
      );
    }

    // 3. Dependencies of the open file (and of the top symbol hit).
    const dependencyRoots = [request.openFile, rankedHits[0]?.[0]].filter(
      (value): value is string => Boolean(value),
    );
    for (const root of dependencyRoots.slice(0, 2)) {
      const imports = this.deps.store
        .importsForFile(request.workspace, root)
        .filter((entry) => entry.resolvedPath)
        .slice(0, MAX_FILES_PER_SOURCE);
      for (const entry of imports) {
        if (!entry.resolvedPath) continue;
        await addFile(
          "dependency",
          entry.resolvedPath,
          60,
          `imported by ${root}`,
        );
      }
    }

    // 5. Git-modified files: the working tree is usually the task's subject.
    const git = await this.deps.search
      .gitContext(request.workspace)
      .catch(() => null);
    if (git?.isRepo) {
      for (const modified of git.modified.slice(0, MAX_FILES_PER_SOURCE)) {
        if (request.openFile && modified === request.openFile) continue;
        await addFile("git", modified, 65, "modified in the working tree");
      }
    }

    // 6. Recently modified files (cheap, catches "what was I just doing").
    for (const recent of this.deps.store
      .recentIndexedFiles(request.workspace, 5)
      .slice(0, 3)) {
      if (recent.path === request.openFile) continue;
      await addFile("recent", recent.path, 35, "recently modified");
    }

    // 7. Related tests for the files gathered so far.
    const touched = candidates
      .map((candidate) => candidate.path)
      .filter((value): value is string => Boolean(value))
      .slice(0, 8);
    if (touched.length) {
      const indexed = this.deps.store.indexedFiles(request.workspace);
      const tests = indexed
        .map((entry) => entry.path)
        .filter((file) =>
          /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[a-z]+$/i.test(file),
        )
        .filter((file) =>
          touched.some((source) => {
            const base = path
              .basename(source)
              .replace(/\.[^.]+$/, "")
              .toLowerCase();
            return base.length > 2 && file.toLowerCase().includes(base);
          }),
        )
        .slice(0, 3);
      for (const testFile of tests)
        await addFile("test", testFile, 55, "related test");
    }

    // 8. Configuration files that describe how the project is built/tested.
    for (const config of [
      "package.json",
      "tsconfig.json",
      ".g1code/instructions.md",
      "README.md",
    ]) {
      if (config === "README.md" && request.prompt.length < 40) {
        // README is large; only include it for broad questions.
        continue;
      }
      await addFile(
        config === ".g1code/instructions.md" ? "instructions" : "config",
        config,
        40,
        "project configuration",
      );
    }

    // 9. Previous session context.
    if (request.sessionId) {
      const summary = this.deps.store.taskSummary(request.sessionId) as
        { summary?: string } | undefined;
      const memory = this.deps.store.taskMemory(request.sessionId) as
        { summary?: string } | undefined;
      const previous = summary?.summary || memory?.summary;
      if (previous) {
        candidates.push({
          kind: "session",
          priority: 45,
          reason: "previous session context",
          content: previous.slice(0, 4000),
        });
      }
    }

    // Rank, deduplicate by content hash, and cut to the strict budget.
    const seenHashes = new Set<string>();
    const ranked = candidates
      .map((candidate) => ({
        ...candidate,
        content: candidate.content.trim(),
        hash: hash(candidate.content),
      }))
      .filter((candidate) => {
        if (!candidate.content) return false;
        if (candidate.hash && seenHashes.has(candidate.hash)) {
          excluded.push({
            path: candidate.path,
            reason: "duplicate content already included",
          });
          return false;
        }
        if (candidate.hash) seenHashes.add(candidate.hash);
        return true;
      })
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          (a.path ?? "").localeCompare(b.path ?? "") ||
          a.kind.localeCompare(b.kind),
      );

    const included: ContextManifestEntry[] = [];
    const blocks: string[] = [];
    const parts: ContextPart[] = [];
    let used = 0;
    for (const candidate of ranked) {
      const remaining = budgetChars - used;
      if (remaining < 400) {
        excluded.push({
          path: candidate.path,
          reason: "context budget reached",
        });
        continue;
      }
      const content = candidate.content.slice(0, remaining);
      const truncated = content.length < candidate.content.length;
      used += content.length;
      included.push({
        path: candidate.path,
        kind: candidate.kind,
        reason: candidate.reason,
        chars: content.length,
        truncated,
      });
      const block =
        candidate.kind === "attachment" || candidate.kind === "selection"
          ? `### ${candidate.kind === "selection" ? `Selection from ${candidate.path ?? "editor"}` : "Attached context"}\n${content}`
          : `### ${candidate.path ?? candidate.kind} (${candidate.reason})\n\`\`\`\n${wrapUntrusted(content, candidate.path ?? candidate.kind).content}\n\`\`\``;
      blocks.push(block);
      parts.push({
        kind: candidate.kind,
        content: block,
        priority: 100 - included.length,
      });
    }

    const text = blocks.length
      ? `## Repository context (assembled automatically)\n${blocks.join("\n\n")}`
      : "";

    return {
      text,
      parts,
      manifest: {
        budgetChars,
        usedChars: used,
        included,
        excluded: excluded.slice(0, 50),
        timings: { assembleMs: Date.now() - started, searchMs },
      },
    };
  }
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
