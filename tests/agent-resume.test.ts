import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  classifyTool,
  hashArguments,
  snapshotFiles,
  reconcileCheckpoint,
  type SafeCheckpoint,
} from "../packages/agent/resume";

test("Tool classification distinguishes read-only from side-effecting tools", () => {
  assert.equal(classifyTool("read_file"), "READ_ONLY");
  assert.equal(classifyTool("list_directory"), "READ_ONLY");
  assert.equal(classifyTool("run_tests"), "IDEMPOTENT");
  assert.equal(classifyTool("apply_patch"), "SIDE_EFFECTING");
  assert.equal(classifyTool("write_file"), "SIDE_EFFECTING");
  assert.equal(classifyTool("run_command"), "NON_REPLAYABLE");
});

test("Safe resume succeeds when workspace files match checkpoint snapshot", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "g1code-resume-1-"));
  try {
    const srcFile = path.join(workspace, "index.ts");
    await fs.writeFile(srcFile, "export const a = 1;\n", "utf8");

    const fileHashes = await snapshotFiles(workspace, ["index.ts"]);

    const checkpoint: SafeCheckpoint = {
      sessionId: "session-resume-1",
      state: "OBSERVING",
      iteration: 2,
      toolCalls: 1,
      messages: [{ role: "user", content: "hello" }],
      sideEffects: [
        {
          id: "se-1",
          toolName: "apply_patch",
          argumentsHash: hashArguments({ path: "index.ts" }),
          filePath: "index.ts",
          executedAt: new Date().toISOString(),
        },
      ],
      fileHashes,
      resumable: true,
      savedAt: new Date().toISOString(),
    };

    const reconciliation = await reconcileCheckpoint(checkpoint, workspace);
    assert.equal(reconciliation.safeToResume, true);
    assert.equal(reconciliation.modifiedFiles.length, 0);
    assert.equal(reconciliation.replayedSideEffects, 1);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("Safe resume detects external modifications and refuses to overwrite blindly", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "g1code-resume-2-"));
  try {
    const srcFile = path.join(workspace, "index.ts");
    await fs.writeFile(srcFile, "export const a = 1;\n", "utf8");

    const fileHashes = await snapshotFiles(workspace, ["index.ts"]);

    const checkpoint: SafeCheckpoint = {
      sessionId: "session-resume-2",
      state: "OBSERVING",
      iteration: 2,
      toolCalls: 1,
      messages: [{ role: "user", content: "hello" }],
      sideEffects: [],
      fileHashes,
      resumable: true,
      savedAt: new Date().toISOString(),
    };

    // User or external editor modifies file concurrently
    await fs.writeFile(srcFile, "export const a = 2; // developer edited this\n", "utf8");

    const reconciliation = await reconcileCheckpoint(checkpoint, workspace);
    assert.equal(reconciliation.safeToResume, false);
    assert.ok(reconciliation.reason?.includes("External modifications detected"));
    assert.deepEqual(reconciliation.modifiedFiles, ["index.ts"]);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
});
