import { promises as fs } from "node:fs";
import path from "node:path";
import { scanRepository, FileIndexEntry } from "./repository";

export type SearchResult = {
  path: string;
  score: number;
  line?: number;
  preview?: string;
};
export type SymbolSearchResult = {
  symbol: string;
  kind: string;
  path: string;
  line: number;
  column: number;
  parent?: string;
};
export async function rankedSearch(
  root: string,
  query: string,
  entries?: FileIndexEntry[],
) {
  const files = entries ?? (await scanRepository(root));
  const normalized = query.toLowerCase();
  const results: SearchResult[] = [];
  for (const entry of files) {
    const name = path.basename(entry.path).toLowerCase();
    const relative = entry.path.toLowerCase();
    let score =
      (name === normalized ? 100 : name.includes(normalized) ? 40 : 0) +
      (relative.includes(normalized) ? 15 : 0);
    if (!score) continue;
    const content = await fs
      .readFile(path.join(root, entry.path), "utf8")
      .catch(() => "");
    const lineIndex = content.toLowerCase().indexOf(normalized);
    if (lineIndex >= 0) score += 35;
    results.push({
      path: entry.path,
      score,
      line:
        lineIndex >= 0
          ? content.slice(0, lineIndex).split("\n").length
          : undefined,
      preview:
        lineIndex >= 0
          ? content
              .split(/\r?\n/)
              [content.slice(0, lineIndex).split("\n").length - 1]?.trim()
          : undefined,
    });
  }
  return results
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 50);
}
