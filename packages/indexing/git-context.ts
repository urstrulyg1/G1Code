import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Git-aware repository state, computed with two bounded git invocations rather
 * than one call per file.
 *
 *  * `git status --porcelain` gives the working-tree state.
 *  * `git log -n <limit> --name-only` gives per-file last-commit metadata for the
 *    recent history window. Files outside that window simply have no last-commit
 *    metadata, which is honest and cheap.
 */
export type FileGitInfo = {
  path: string;
  status: string;
  lastCommit?: string | null;
  lastCommitAt?: string | null;
  lastCommitSubject?: string | null;
};

export type GitRepositoryContext = {
  isRepo: boolean;
  branch: string;
  head: string;
  files: FileGitInfo[];
  modified: string[];
  untracked: string[];
  recentCommits: Array<{ hash: string; at: string; subject: string }>;
};

const MAX_HISTORY_COMMITS = 200;
const STATUS_CODES: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "conflicted",
  "?": "untracked",
  "!": "ignored",
};

export async function collectGitContext(
  workspace: string,
  options: { historyLimit?: number } = {},
): Promise<GitRepositoryContext> {
  const empty: GitRepositoryContext = {
    isRepo: false,
    branch: "",
    head: "",
    files: [],
    modified: [],
    untracked: [],
    recentCommits: [],
  };
  try {
    const [branchResult, headResult] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: workspace,
        timeout: 10_000,
      }).catch(() => ({ stdout: "" })),
      execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: workspace,
        timeout: 10_000,
      }).catch(() => ({ stdout: "" })),
    ]);
    const branch = branchResult.stdout.trim();
    if (!branch) return empty;
    const head = headResult.stdout.trim();

    const statusResult = await execFileAsync(
      "git",
      ["status", "--porcelain", "-z", "--untracked-files=all"],
      { cwd: workspace, timeout: 20_000, maxBuffer: 20 * 1024 * 1024 },
    ).catch(() => ({ stdout: "" }));

    const files = new Map<string, FileGitInfo>();
    const entries = statusResult.stdout.split("\0").filter(Boolean);
    for (const entry of entries) {
      const code = entry.slice(0, 2);
      const filePath = entry.slice(3).trim();
      if (!filePath) continue;
      const normalized = filePath.replaceAll("\\", "/");
      const status = code.includes("?")
        ? "untracked"
        : (STATUS_CODES[code.trim()[0] ?? ""] ?? "modified");
      files.set(normalized, { path: normalized, status });
    }

    const historyLimit = Math.min(
      options.historyLimit ?? MAX_HISTORY_COMMITS,
      MAX_HISTORY_COMMITS,
    );
    const logResult = await execFileAsync(
      "git",
      [
        "log",
        `-n`,
        String(historyLimit),
        "--name-only",
        "--pretty=format:%x01%H%x1f%ct%x1f%s",
      ],
      { cwd: workspace, timeout: 30_000, maxBuffer: 40 * 1024 * 1024 },
    ).catch(() => ({ stdout: "" }));

    const recentCommits: GitRepositoryContext["recentCommits"] = [];
    let currentCommit:
      { hash: string; at: string; subject: string } | undefined;
    for (const rawLine of logResult.stdout.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith("\u0001")) {
        const [hash, at, ...rest] = line.slice(1).split("\u001f");
        currentCommit = {
          hash,
          at: new Date(Number(at) * 1000).toISOString(),
          subject: rest.join("\u001f"),
        };
        recentCommits.push(currentCommit);
        continue;
      }
      if (!currentCommit) continue;
      const normalized = line.replaceAll("\\", "/");
      const existing = files.get(normalized) ?? {
        path: normalized,
        status: "clean",
      };
      if (!existing.lastCommit) {
        existing.lastCommit = currentCommit.hash;
        existing.lastCommitAt = currentCommit.at;
        existing.lastCommitSubject = currentCommit.subject;
      }
      files.set(normalized, existing);
    }

    return {
      isRepo: true,
      branch,
      head,
      files: [...files.values()],
      modified: [...files.values()]
        .filter(
          (file) => file.status !== "untracked" && file.status !== "clean",
        )
        .map((file) => file.path),
      untracked: [...files.values()]
        .filter((file) => file.status === "untracked")
        .map((file) => file.path),
      recentCommits,
    };
  } catch {
    return empty;
  }
}

/** Map changed source files to the tests most likely to cover them. */
export function relatedTestPaths(
  changed: string[],
  indexed: string[],
): string[] {
  const testFiles = indexed.filter((file) =>
    /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/i.test(file),
  );
  const matches = new Set<string>();
  for (const file of changed) {
    const base = path
      .basename(file)
      .replace(/\.[^.]+$/, "")
      .toLowerCase();
    if (!base) continue;
    for (const candidate of testFiles) {
      const candidateBase = path
        .basename(candidate)
        .replace(/\.[^.]+$/, "")
        .toLowerCase()
        .replace(/\.(test|spec)$/, "");
      if (candidateBase === base || candidate.toLowerCase().includes(base)) {
        matches.add(candidate);
      }
    }
  }
  return [...matches].slice(0, 25);
}
