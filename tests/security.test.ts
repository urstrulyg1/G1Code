import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { safeRealPath } from "../packages/tools/workspace";
import { scanRepository } from "../packages/indexing/repository";

test("real path validation rejects symlink workspace escapes", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "g1code-secure-"));
  const outside = await mkdtemp(path.join(tmpdir(), "g1code-outside-"));
  await writeFile(path.join(outside, "secret.txt"), "secret");
  await symlink(outside, path.join(workspace, "link"));
  await assert.rejects(
    () => safeRealPath(workspace, "link/secret.txt"),
    /outside/,
  );
});

test("real path validation permits workspace files", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "g1code-secure-"));
  await mkdir(path.join(workspace, "src"));
  await writeFile(path.join(workspace, "src", "index.ts"), "export {};");
  assert.equal(
    await safeRealPath(workspace, "src/index.ts"),
    path.join(workspace, "src", "index.ts"),
  );
});

test("real path validation rejects a final-file symlink replacement", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "g1code-secure-"));
  const outside = await mkdtemp(path.join(tmpdir(), "g1code-outside-"));
  await writeFile(path.join(outside, "secret.txt"), "secret");
  await symlink(
    path.join(outside, "secret.txt"),
    path.join(workspace, "file.txt"),
  );
  await assert.rejects(() => safeRealPath(workspace, "file.txt"), /outside/);
});

test("repository indexing excludes common secret files", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "g1code-secrets-"));
  await writeFile(path.join(workspace, ".env"), "API_KEY=not-real");
  await writeFile(
    path.join(workspace, "server.ts"),
    "export function server() {}\n",
  );
  const entries = await scanRepository(workspace);
  assert.deepEqual(
    entries.map((entry) => entry.path),
    ["server.ts"],
  );
});
