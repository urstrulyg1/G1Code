import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
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
  async function visit(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !ignored.has(entry.name))
        await visit(path.join(directory, entry.name));
      else if (entry.isFile() && !sensitive.test(entry.name)) {
        const file = path.join(directory, entry.name);
        const content = await fs.readFile(file).catch(() => null);
        if (!content) continue;
        const stat = await fs.stat(file);
        result.push({
          path: path.relative(root, file),
          language: language(file),
          size: stat.size,
          modifiedTime: stat.mtime.toISOString(),
          hash: createHash("sha256").update(content).digest("hex"),
        });
        onProgress?.(++scanned);
      }
    }
  }
  await visit(root);
  return result;
}
