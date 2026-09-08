import { promises as fs } from "node:fs";
import path from "node:path";
import { Project } from "./detector";

export type TestCandidate = { path: string; score: number; reason: string };
async function files(root: string, directory = root): Promise<string[]> {
  const results: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (
      ["node_modules", ".git", "dist", "build", "target"].includes(entry.name)
    )
      continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await files(root, full)));
    else if (entry.isFile()) results.push(path.relative(root, full));
  }
  return results;
}
export async function discoverTests(
  root: string,
  changedPaths: string[],
  _project?: Project,
): Promise<TestCandidate[]> {
  const all = await files(root);
  const candidates: TestCandidate[] = [];
  for (const changed of changedPaths) {
    const base = path.basename(changed, path.extname(changed));
    const normalized = base.replace(/[-_.](test|spec|tests|specs)$/i, "");
    for (const candidate of all) {
      const name = path.basename(candidate).toLowerCase();
      const lower = normalized.toLowerCase();
      let score = 0;
      let reason = "related test path";
      if (
        name === `${lower}test${path.extname(candidate)}`.toLowerCase() ||
        name === `${lower}.test${path.extname(candidate)}`.toLowerCase()
      ) {
        score = 100;
        reason = "matching test filename";
      } else if (name.includes(lower) && /(test|spec)/i.test(name)) {
        score = 70;
        reason = "matching test symbol";
      } else if (
        path.dirname(candidate) === path.dirname(changed) &&
        /(test|spec)/i.test(name)
      ) {
        score = 35;
        reason = "same directory test";
      }
      if (score) candidates.push({ path: candidate, score, reason });
    }
  }
  return candidates
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .filter(
      (candidate, index, list) =>
        list.findIndex((item) => item.path === candidate.path) === index,
    );
}
