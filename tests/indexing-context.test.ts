import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { scanRepository, extractSymbols } from "../packages/indexing/repository";
import { attributeFiles } from "../packages/git/baseline";
import { ContextIntelligence } from "../packages/context/intelligence";

test("indexing extracts symbols and context suppresses unchanged files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "g1code-index-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "sample.ts"), "export function add(a: number, b: number) { return a + b; }\nclass Calculator {}\n");
  const entries = await scanRepository(root);
  assert.equal(entries[0]?.language, "typescript");
  assert.deepEqual(extractSymbols("export function add() {}\nclass Calculator {}", "sample.ts").map((item) => item.symbol), ["add", "Calculator"]);
  const context = new ContextIntelligence();
  assert.equal(context.assemble([{ kind: "file", path: "src/sample.ts", content: "same", priority: 2 }]).length, 1);
  assert.equal(context.assemble([{ kind: "file", path: "src/sample.ts", content: "same", priority: 2 }]).length, 0);
  assert.equal(context.assemble([{ kind: "file", path: "src/sample.ts", content: "changed", priority: 2 }]).length, 1);
});

test("Git attribution separates baseline, agent, and overlap", () => {
  const result = attributeFiles({ branch: "main", head: "abc", status: " M existing.ts\n", diff: "", modifiedFiles: ["existing.ts"], capturedAt: "now" }, ["existing.ts", "new.ts"], " M existing.ts\n M new.ts\n M user.ts\n");
  assert.deepEqual(result.overlapping, ["existing.ts"]);
  assert.deepEqual(result.agent, ["new.ts"]);
  assert.deepEqual(result.preExisting, []);
});

test("context compaction preserves task state and failures", () => {
  const context = new ContextIntelligence();
  const summary = context.compact({ objective: "Fix auth", plan: ["Inspect service", "Run tests"], discoveries: ["Maven project"], changes: ["AuthService.java"], tests: ["AuthServiceTest passed"], failures: ["Expiration case failed"], nextAction: "Diagnose expiration" });
  assert.match(summary, /Objective: Fix auth/);
  assert.match(summary, /Expiration case failed/);
  assert.match(summary, /Next action: Diagnose expiration/);
});
