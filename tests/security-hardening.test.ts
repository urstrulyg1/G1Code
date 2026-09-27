import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { safePath, safeRealPath } from "../packages/tools/workspace";
import { spawnExecutable } from "../packages/tools/command";

test("workspace path guard rejects traversal and sibling-prefix escapes", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "g1code-security-"));
  const sibling = path.join(path.dirname(workspace), `${path.basename(workspace)}-sibling`);

  assert.equal(safePath(workspace, "src/main.ts"), path.join(workspace, "src/main.ts"));
  assert.throws(() => safePath(workspace, "../outside"), /outside the selected workspace/);
  assert.throws(() => safePath(workspace, sibling), /outside the selected workspace/);
});

test("workspace realpath guard rejects symlink escapes", async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "g1code-security-"));
  const outside = await mkdtemp(path.join(tmpdir(), "g1code-outside-"));
  await mkdir(path.join(outside, "nested"), { recursive: true });
  const link = path.join(workspace, "linked");

  try {
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (process.platform === "win32") {
      t.skip(`symlink creation is unavailable on this runner: ${String(error)}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    () => safeRealPath(workspace, "linked/nested/file.txt"),
    /outside the selected workspace/,
  );
});

test("spawned tool commands do not inherit secret-like environment variables", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "g1code-command-"));
  await writeFile(path.join(workspace, "marker.txt"), "ok");

  const execution = spawnExecutable({
    executable: process.execPath,
    args: ["-e", "process.stdout.write(process.env.G1CODE_TEST_SECRET || 'MISSING')"],
    cwd: workspace,
    env: { ...process.env, G1CODE_TEST_SECRET: "must-not-leak" },
    timeoutMs: 10_000,
  });

  const result = await execution.wait();
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "MISSING");
});
