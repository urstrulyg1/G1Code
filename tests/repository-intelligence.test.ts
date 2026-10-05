import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { openDatabase } from "../packages/database/connection";
import { DatabaseStore } from "../packages/database/repositories";
import {
  extractImports,
  resolveImportPath,
} from "../packages/indexing/imports";
import { collectGitContext } from "../packages/indexing/git-context";
import { RepositoryIndexService } from "../packages/indexing/service";
import { RepositorySearchService } from "../packages/indexing/search-service";
import { ContextAssembler } from "../packages/context/assembler";
import { repositoryTools } from "../packages/indexing/tools";
import {
  isKnownTool,
  decidePermission,
} from "../packages/security/permission-policy";
import type { ToolPermissionSettings } from "../packages/security/permission-policy";

const execFileAsync = promisify(execFile);

async function tempStore() {
  const dir = await mkdtemp(path.join(tmpdir(), "g1code-intel-"));
  const store = new DatabaseStore(openDatabase(dir));
  return { dir, store };
}

async function project(name: string, files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), name));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
  return root;
}

test("import extraction understands JS/TS, Python and Go syntax", () => {
  const imports = extractImports(
    [
      'import { add } from "./math";',
      'import fs from "node:fs";',
      'const legacy = require("./legacy");',
    ].join("\n"),
    "src/index.ts",
  );
  const modules = imports.map((entry) => entry.module);
  assert.ok(modules.includes("./math"));
  assert.ok(modules.includes("./legacy"));
  assert.ok(modules.includes("node:fs"));
  assert.equal(
    imports.find((entry) => entry.module === "./math")?.kind,
    "import",
  );
  assert.equal(
    imports.find((entry) => entry.module === "./legacy")?.kind,
    "require",
  );

  const python = extractImports(
    "import os\nfrom .util import helper\n",
    "pkg/main.py",
  );
  assert.ok(python.some((entry) => entry.module === ".util"));
  const go = extractImports(
    'import (\n\t"fmt"\n\t"example.com/app/util"\n)\n',
    "main.go",
  );
  assert.ok(go.some((entry) => entry.module === "example.com/app/util"));
});

test("import resolution maps specifiers to real files without leaving the workspace", () => {
  const known = new Set([
    "src/math.ts",
    "src/util/index.ts",
    "app/main.py",
    "app/helpers.py",
  ]);
  assert.equal(
    resolveImportPath("src/index.ts", "./math", known),
    "src/math.ts",
  );
  assert.equal(
    resolveImportPath("src/index.ts", "./util", known),
    "src/util/index.ts",
  );
  assert.equal(
    resolveImportPath("src/index.ts", "../app/helpers.py", known),
    "app/helpers.py",
  );
  // package specifiers are not resolvable inside the repository
  assert.equal(resolveImportPath("src/index.ts", "react", known), null);
});

test("index service is incremental, stores symbols/imports and survives file deletion", async () => {
  const { store } = await tempStore();
  const root = await project("g1code-index-", {
    "src/math.ts":
      "export function add(a: number, b: number) { return a + b; }\n",
    "src/index.ts":
      'import { add } from "./math";\nexport const total = add(1, 2);\n',
    "package.json": JSON.stringify({ name: "sample" }),
  });
  const service = new RepositoryIndexService(store);

  const first = await service.index(root);
  assert.equal(first.files, 3);
  assert.equal(first.indexed, 3);
  assert.equal(store.indexFreshness(root)?.indexedAt !== undefined, true);
  assert.ok(
    store.symbolsForFile(root, "src/math.ts").some((s) => s.symbol === "add"),
  );
  const imports = store.importsForFile(root, "src/index.ts");
  assert.ok(imports.some((entry) => entry.resolvedPath === "src/math.ts"));

  // Second run: nothing changed, so nothing is re-parsed.
  const second = await service.index(root);
  assert.equal(second.indexed, 0, "unchanged files are not re-indexed");

  // Incremental update through indexPaths only touches the given file.
  await writeFile(
    path.join(root, "src/math.ts"),
    "export function subtract(a: number, b: number) { return a - b; }\n",
  );
  await service.indexPaths(root, ["src/math.ts"]);
  const symbols = store
    .symbolsForFile(root, "src/math.ts")
    .map((s) => s.symbol);
  assert.ok(symbols.includes("subtract"));
  assert.ok(!symbols.includes("add"), "stale symbols are replaced");

  // Deleting a file removes it from the index on the next full pass.
  const { rm } = await import("node:fs/promises");
  await rm(path.join(root, "src/index.ts"));
  const third = await service.index(root);
  assert.equal(third.removed, 1);
  assert.equal(
    store.indexedFiles(root).some((entry) => entry.path === "src/index.ts"),
    false,
  );
  store.dispose();
});

test("index paths are POSIX on every platform", async () => {
  const { store } = await tempStore();
  const root = await project("g1code-paths-", {
    "src/nested/deep/file.ts": "export const nested = 1;\n",
  });
  const service = new RepositoryIndexService(store);
  await service.index(root);
  const paths = store.indexedFiles(root).map((entry) => entry.path);
  assert.deepEqual(paths, ["src/nested/deep/file.ts"]);
  assert.equal(
    paths.some((entry) => entry.includes("\\")),
    false,
    "index keys never contain platform separators",
  );

  // Watcher-driven updates accept either separator and still land on the same
  // index entry (Windows watchers report native paths).
  await writeFile(
    path.join(root, "src/nested/deep/file.ts"),
    "export const nested = 2;\n",
  );
  await service.indexPaths(root, ["src\\nested\\deep\\file.ts"]);
  assert.deepEqual(
    store.indexedFiles(root).map((entry) => entry.path),
    ["src/nested/deep/file.ts"],
  );
  assert.equal(
    store.symbolsForFile(root, "src/nested/deep/file.ts").length,
    1,
    "the incremental update replaced the same entry",
  );
  store.dispose();
});

test("ranked search finds files by name, symbol and text, with reasons", async () => {
  const { store } = await tempStore();
  const root = await project("g1code-search-", {
    "src/payments/processor.ts":
      "export class PaymentProcessor {\n  processCharge() { return 'ok'; }\n}\n",
    "src/auth/session.ts": "export function createSession() {}\n",
    "src/unrelated.ts": "export const other = 1;\n",
  });
  const service = new RepositoryIndexService(store);
  await service.index(root);
  const search = new RepositorySearchService(store);

  const bySymbol = await search.search(root, "PaymentProcessor", { limit: 5 });
  assert.equal(bySymbol.hits[0]?.path, "src/payments/processor.ts");
  assert.ok(
    bySymbol.hits[0]?.reasons.some((reason) => reason.startsWith("symbol")),
  );
  assert.equal(bySymbol.hits[0]?.line, 1);

  const byFilename = await search.search(root, "session", { limit: 5 });
  assert.equal(byFilename.hits[0]?.path, "src/auth/session.ts");

  const byText = await search.search(root, "processCharge", { limit: 5 });
  assert.equal(byText.hits[0]?.path, "src/payments/processor.ts");

  // A search that matches nothing reports that honestly.
  const nothing = await search.search(root, "zzz-not-present", { limit: 5 });
  assert.equal(nothing.hits.length, 0);
  store.dispose();
});

test("git-aware search boosts working-tree modifications", async (t) => {
  const { store } = await tempStore();
  const root = await project("g1code-git-", {
    "src/a.ts": "export const a = 1;\n",
    "src/b.ts": "export const b = 1;\n",
  });
  try {
    await execFileAsync("git", ["-C", root, "init", "-q"]);
    await execFileAsync("git", [
      "-C",
      root,
      "config",
      "user.email",
      "t@example.com",
    ]);
    await execFileAsync("git", ["-C", root, "config", "user.name", "Test"]);
    await execFileAsync("git", ["-C", root, "add", "."]);
    await execFileAsync("git", ["-C", root, "commit", "-qm", "init"]);
  } catch {
    t.skip("git is not available in this environment");
    return;
  }
  await writeFile(path.join(root, "src/b.ts"), "export const b = 2;\n");

  const context = await collectGitContext(root);
  assert.equal(context.isRepo, true);
  assert.deepEqual(context.modified, ["src/b.ts"]);

  const service = new RepositoryIndexService(store);
  await service.index(root);
  const search = new RepositorySearchService(store);
  const result = await search.search(root, "export", {
    limit: 5,
    maxTextFiles: 50,
  });
  const modified = result.hits.find((hit) => hit.path === "src/b.ts");
  assert.ok(modified, "the modified file is returned");
  assert.equal(modified?.gitStatus, "modified");
  assert.ok(
    result.hits[0]?.path === "src/b.ts",
    "the dirty file outranks an identical clean file",
  );
  store.dispose();
});

test("context assembler ranks sources, honors the budget and explains itself", async () => {
  const { store } = await tempStore();
  const root = await project("g1code-context-", {
    "src/permissions.ts":
      "export function checkPermission(tool: string) { return tool !== 'dangerous'; }\n",
    "src/other.ts": "export const other = 1;\n",
    "tests/permissions.test.ts":
      "import { checkPermission } from '../src/permissions';\n",
    "package.json": JSON.stringify({ name: "sample" }),
  });
  const index = new RepositoryIndexService(store);
  await index.index(root);
  const assembler = new ContextAssembler({
    store,
    search: new RepositorySearchService(store),
  });

  const assembled = await assembler.assemble({
    workspace: root,
    prompt: "Where is the permission check implemented for tools?",
    openFile: "src/other.ts",
    budgetChars: 20_000,
  });

  const includedPaths = assembled.manifest.included.map((entry) => entry.path);
  assert.ok(
    includedPaths.includes("src/other.ts"),
    "the open file is always included first",
  );
  assert.ok(
    includedPaths.includes("src/permissions.ts"),
    "keyword search contributes the matching source file",
  );
  assert.ok(
    assembled.manifest.usedChars <= 20_000,
    "the strict character budget is respected",
  );
  assert.ok(
    assembled.text.includes("UNTRUSTED"),
    "file content is wrapped as untrusted",
  );
  assert.ok(
    assembled.manifest.included.every(
      (entry) => entry.chars > 0 && entry.reason,
    ),
    "every included file carries a reason",
  );
  assert.equal(
    new Set(includedPaths).size,
    includedPaths.length,
    "no duplicate files in the manifest",
  );

  // An empty prompt still produces a deterministic, useful manifest.
  const bare = await assembler.assemble({ workspace: root, prompt: "" });
  assert.deepEqual(
    bare.manifest.included.map((entry) => entry.kind).includes("open_file"),
    false,
  );
  assert.ok(bare.manifest.budgetChars > 0);

  // Binary/vendor content is excluded rather than silently truncated.
  const binary = await project("g1code-context-bin-", {
    "src/blob.ts": "export const x = 1;\n",
    "node_modules/pkg/index.ts": "export const y = 2;\n",
  });
  const index2 = new RepositoryIndexService(store);
  await index2.index(binary);
  const assembler2 = new ContextAssembler({
    store,
    search: new RepositorySearchService(store),
  });
  const result2 = await assembler2.assemble({
    workspace: binary,
    prompt: "y",
  });
  assert.equal(
    result2.manifest.included.some((entry) =>
      (entry.path ?? "").includes("node_modules"),
    ),
    false,
    "vendor directories are never used as context",
  );
  store.dispose();
});

test("repository tools are permission-classified and read-only", () => {
  const store = { indexedFiles: () => [] } as unknown as DatabaseStore;
  const tools = repositoryTools({
    store,
    search: {} as never,
    index: {} as never,
  });
  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "lookup_symbol",
    "related_tests",
    "repository_metadata",
    "search_repository",
  ]);
  const permissions = {
    readFiles: true,
    searchRepository: true,
    editFiles: false,
    createFiles: false,
    deleteFiles: false,
    renameFiles: false,
    runTests: false,
    runBuilds: false,
    runCommands: false,
    networkTools: false,
  } satisfies ToolPermissionSettings;
  for (const tool of tools) {
    assert.equal(tool.permission, "safe", `${tool.name} must be read-only`);
    assert.equal(
      isKnownTool(tool.name),
      true,
      `${tool.name} must have a policy rule`,
    );
    const verdict = decidePermission({
      toolName: tool.name,
      input: {},
      executionMode: "readonly",
      permissions,
    });
    assert.equal(
      verdict.decision,
      "allow",
      `${tool.name} is allowed in readonly mode`,
    );
  }
});
