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
const ignored = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  "vendor",
]);
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
      else if (entry.isFile()) {
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
