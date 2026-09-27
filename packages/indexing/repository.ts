import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

const MAX_INDEXABLE_FILE_BYTES = 2 * 1024 * 1024;
export type FileIndexEntry = {
  path: string;
  language: string;
  size: number;
  modifiedTime: string;
  hash: string;
};
export type SymbolIndexEntry = {
  symbol: string;
  kind: string;
  line: number;
  column: number;
  parent?: string;
};
const ignored = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  "vendor",
]);
const sensitive =
  /^(\.env(?:\..*)?|.*\.(pem|key|p12|pfx)|id_rsa|credentials(?:\..*)?|secrets?(?:\..*)?)$/i;
const language = (file: string) =>
  ({
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
  })[path.extname(file).slice(1)] ?? "text";
export const fileLanguage = language;
export function extractSymbols(
  content: string,
  file: string,
): SymbolIndexEntry[] {
  const result: SymbolIndexEntry[] = [];
  const extension = path.extname(file).toLowerCase();
  const patterns: Array<[RegExp, string]> =
    extension === ".py"
      ? [
          [/^\s*(?:async\s+)?def\s+([A-Za-z_$][\w$]*)/gm, "function"],
          [/^\s*class\s+([A-Za-z_$][\w$]*)/gm, "class"],
        ]
      : [
          [
            /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
            "function",
          ],
          [/\bclass\s+([A-Za-z_$][\w$]*)/g, "class"],
          [/\binterface\s+([A-Za-z_$][\w$]*)/g, "interface"],
          [/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, "variable"],
          [/\b(?:func|fn)\s+([A-Za-z_$][\w$]*)/g, "function"],
          [/\b(?:struct|enum)\s+([A-Za-z_$][\w$]*)/g, "struct"],
        ];
  for (const [pattern, kind] of patterns) {
    for (const match of content.matchAll(pattern)) {
      const index = match.index ?? 0;
      const line = content.slice(0, index).split(/\r?\n/).length;
      const lineStart = content.lastIndexOf("\n", index - 1) + 1;
      result.push({
        symbol: match[1],
        kind,
        line,
        column: index - lineStart + 1,
      });
    }
  }
  return result.sort((a, b) => a.line - b.line || a.column - b.column);
}
export async function scanRepository(
  root: string,
  onProgress?: (scanned: number) => void,
): Promise<FileIndexEntry[]> {
  const result: FileIndexEntry[] = [];
  let scanned = 0;

  async function gitCandidates(): Promise<string[] | null> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        { cwd: root, maxBuffer: 10 * 1024 * 1024 },
      );
      return stdout
        .split("\0")
        .filter(Boolean)
        .map((entry) => entry.split(path.sep).join("/"));
    } catch {
      return null;
    }
  }

  async function walkFallback(): Promise<string[]> {
    const files: string[] = [];
    const ignorePatterns = await fs
      .readFile(path.join(root, ".gitignore"), "utf8")
      .then((text) =>
        text.split(/\r?\n/).map((line) => line.trim()).filter(
          (line) => line && !line.startsWith("#") && !line.startsWith("!"),
        ),
      )
      .catch(() => [] as string[]);

    const shouldIgnore = (relativePath: string) => {
      const normalized = relativePath.replaceAll("\\", "/");
      const base = path.posix.basename(normalized);
      return ignorePatterns.some((pattern) => {
        const p = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
        if (p.endsWith("/")) return normalized.startsWith(p);
        if (p.startsWith("*")) return base.endsWith(p.slice(1));
        if (p.endsWith("*")) return base.startsWith(p.slice(0, -1));
        if (p.includes("*")) {
          const [prefix, suffix] = p.split("*", 2);
          return normalized.startsWith(prefix) && normalized.endsWith(suffix);
        }
        return normalized === p || normalized.endsWith("/" + p);
      });
    };

    async function visit(directory: string) {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        const relative = path.relative(root, absolute).replaceAll("\\", "/");
        if (ignored.has(entry.name) || shouldIgnore(relative + (entry.isDirectory() ? "/" : ""))) continue;
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile()) files.push(path.relative(root, absolute));
      }
    }
    await visit(root);
    return files;
  }

  const candidates = (await gitCandidates()) ?? (await walkFallback());

  for (const relativePath of candidates) {
    const file = path.resolve(root, relativePath);
    let stat;
    try {
      stat = await fs.lstat(file);
    } catch {
      continue;
    }

    // Never index symlink targets. Git may legitimately track symlinks, but
    // following them would make repository context cross workspace boundaries.
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    if (stat.size > MAX_INDEXABLE_FILE_BYTES) continue;

    const baseName = path.basename(relativePath);
    if (sensitive.test(baseName)) continue;

    const content = await fs.readFile(file).catch(() => null);
    if (!content || content.length === 0) continue;

    // Binary/media/generated blobs do not provide useful symbol context and
    // can be extremely expensive to hash/index.
    if (content.subarray(0, Math.min(content.length, 8192)).includes(0)) continue;

    result.push({
      path: path.relative(root, file),
      language: language(file),
      size: stat.size,
      modifiedTime: stat.mtime.toISOString(),
      hash: createHash("sha256").update(content).digest("hex"),
    });
    onProgress?.(++scanned);
  }

  result.sort((a, b) => a.path.localeCompare(b.path));
  return result;
}
