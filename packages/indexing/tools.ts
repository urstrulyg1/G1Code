import path from "node:path";
import type { DatabaseStore } from "../database/repositories";
import type { AgentTool } from "../tools/types";
import type {
  RepositorySearchKind,
  RepositorySearchService,
} from "./search-service";
import type { RepositoryIndexService } from "./service";

/**
 * Read-only repository intelligence tools.
 *
 * These are the tools that make "where is authentication implemented?"
 * answerable without reading arbitrary files: the model asks for a ranked
 * search, and the index supplies both the answer and the evidence.
 */
export function repositoryTools(deps: {
  store: DatabaseStore;
  search: RepositorySearchService;
  index: RepositoryIndexService;
}): AgentTool[] {
  return [
    {
      name: "search_repository",
      description:
        'Ranked repository search over filename, path, symbol, text, dependencies, and git state. Use this first to answer "where is X implemented?". Returns ranked hits with the reason each file matched.',
      permission: "safe",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
          kind: {
            type: "string",
            enum: ["mixed", "filename", "symbol", "text", "recent"],
          },
        },
        required: ["query"],
      },
      execute: async (value, context) => {
        const input = value as {
          query?: unknown;
          limit?: unknown;
          kind?: unknown;
        };
        const query = typeof input.query === "string" ? input.query.trim() : "";
        if (!query)
          return { content: "A non-empty query is required.", isError: true };
        const limit =
          typeof input.limit === "number" && Number.isFinite(input.limit)
            ? Math.max(1, Math.min(50, Math.floor(input.limit)))
            : 15;
        const kind: RepositorySearchKind =
          typeof input.kind === "string" &&
          ["mixed", "filename", "symbol", "text", "recent"].includes(input.kind)
            ? (input.kind as RepositorySearchKind)
            : "mixed";
        const result = await deps.search.search(context.workspace, query, {
          limit,
          kind,
          signal: context.signal,
        });
        if (!result.hits.length) {
          return {
            content: JSON.stringify({
              query,
              hits: [],
              note: "No indexed match. Try a different keyword, or list_directory to see whether the workspace has been indexed.",
            }),
          };
        }
        return {
          content: JSON.stringify({
            query,
            kind,
            hits: result.hits.map((hit) => ({
              path: hit.path,
              score: hit.score,
              line: hit.line,
              preview: hit.preview,
              reasons: hit.reasons,
              gitStatus: hit.gitStatus,
            })),
            scannedFiles: result.scannedFiles,
            truncated: result.truncated,
          }),
          matchesCount: result.hits.length,
        };
      },
    },
    {
      name: "lookup_symbol",
      description:
        "Look up symbols (functions, classes, interfaces, variables) by name in the persisted index. Returns file, line, and column so you can read the exact definition instead of guessing.",
      permission: "safe",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" }, limit: { type: "number" } },
        required: ["name"],
      },
      execute: async (value, context) => {
        const input = value as { name?: unknown; limit?: unknown };
        const name = typeof input.name === "string" ? input.name.trim() : "";
        if (!name)
          return { content: "A symbol name is required.", isError: true };
        const limit =
          typeof input.limit === "number" && Number.isFinite(input.limit)
            ? Math.max(1, Math.min(50, Math.floor(input.limit)))
            : 20;
        const symbols = deps.store.searchSymbols(context.workspace, name);
        return {
          content: JSON.stringify({
            name,
            symbols: symbols.slice(0, limit),
            count: symbols.length,
          }),
          matchesCount: Math.min(symbols.length, limit),
        };
      },
    },
    {
      name: "repository_metadata",
      description:
        "Repository metadata: file count, languages, index freshness, git branch, working-tree status, and the most recently modified files. Cheaper than listing the tree.",
      permission: "safe",
      inputSchema: { type: "object", properties: {} },
      execute: async (_value, context) => {
        const files = deps.store.indexedFiles(context.workspace);
        const languages = new Map<string, number>();
        for (const file of files)
          languages.set(file.language, (languages.get(file.language) ?? 0) + 1);
        const git = await deps.search
          .gitContext(context.workspace)
          .catch(() => null);
        const freshness = deps.store.indexFreshness(context.workspace);
        return {
          content: JSON.stringify({
            fileCount: files.length,
            indexedAt: freshness?.indexedAt ?? null,
            indexing: deps.index.isIndexing(context.workspace),
            languages: [...languages.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 12)
              .map(([language, count]) => ({ language, count })),
            git: git?.isRepo
              ? {
                  branch: git.branch,
                  modified: git.modified.slice(0, 25),
                  untracked: git.untracked.slice(0, 25),
                  recentCommits: git.recentCommits.slice(0, 5),
                }
              : null,
            recentFiles: deps.store
              .recentIndexedFiles(context.workspace, 5)
              .map((file) => file.path),
          }),
        };
      },
    },
    {
      name: "related_tests",
      description:
        "Return the tests most likely to cover the given workspace paths, ranked by filename and directory similarity. Use before run_tests to run only what matters.",
      permission: "safe",
      inputSchema: {
        type: "object",
        properties: {
          paths: { type: "array", items: { type: "string" } },
        },
        required: ["paths"],
      },
      execute: async (value, context) => {
        const input = value as { paths?: unknown };
        const paths = Array.isArray(input.paths)
          ? input.paths.filter(
              (entry): entry is string =>
                typeof entry === "string" && entry.length < 500,
            )
          : [];
        if (!paths.length)
          return { content: "At least one path is required.", isError: true };
        const indexed = deps.store.indexedFiles(context.workspace);
        const candidates = indexed
          .map((entry) => entry.path)
          .filter((file) =>
            /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/i.test(
              file,
            ),
          );
        const matches: Array<{ path: string; score: number; covers: string }> =
          [];
        for (const source of paths) {
          const base = path
            .basename(source)
            .replace(/\.[^.]+$/, "")
            .toLowerCase()
            .replace(/[-_.](test|spec|tests|specs)$/, "");
          if (base.length < 3) continue;
          for (const candidate of candidates) {
            const candidateName = candidate.toLowerCase();
            if (candidateName.includes(base)) {
              matches.push({
                path: candidate,
                score: candidateName.includes(`/${base}.`) ? 100 : 60,
                covers: source,
              });
            }
          }
        }
        const unique = new Map<
          string,
          { path: string; score: number; covers: string }
        >();
        for (const match of matches.sort((a, b) => b.score - a.score)) {
          if (!unique.has(match.path)) unique.set(match.path, match);
        }
        return {
          content: JSON.stringify({
            tests: [...unique.values()].slice(0, 20),
            totalTestFiles: candidates.length,
          }),
        };
      },
    },
  ];
}
