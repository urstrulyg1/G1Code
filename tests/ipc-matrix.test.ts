import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { DatabaseStore } from "../packages/database/repositories";
import { ChangeService } from "../packages/tools/change-service";
import {
  requireBoundedString,
  requireObject,
  requireAction,
} from "../packages/security/validation";
import { safeRealPath } from "../packages/tools/workspace";

function createInMemoryStore() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version VALUES (2);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, mode TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE tool_calls (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT, tool_name TEXT NOT NULL, arguments TEXT NOT NULL, result TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT);
    CREATE TABLE agent_events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, timestamp TEXT NOT NULL);
    CREATE TABLE file_changes (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, path TEXT NOT NULL, original_hash TEXT NOT NULL, proposed_hash TEXT NOT NULL, original_content TEXT NOT NULL DEFAULT '', proposed_content TEXT NOT NULL DEFAULT '', applied_content TEXT, patch TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE files (workspace_id TEXT NOT NULL, path TEXT NOT NULL, language TEXT NOT NULL, size INTEGER NOT NULL, modified_time TEXT NOT NULL, hash TEXT NOT NULL, indexed_at TEXT NOT NULL, PRIMARY KEY (workspace_id, path));
    CREATE TABLE symbols (workspace_id TEXT NOT NULL, path TEXT NOT NULL, symbol TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL, column_number INTEGER NOT NULL, parent TEXT, PRIMARY KEY (workspace_id, path, symbol, kind, line));
    CREATE TABLE repository_indexes (workspace_id TEXT PRIMARY KEY, indexed_at TEXT NOT NULL);
    CREATE TABLE git_baselines (session_id TEXT PRIMARY KEY, branch TEXT NOT NULL, head TEXT NOT NULL, status TEXT NOT NULL, diff TEXT NOT NULL, modified_files TEXT NOT NULL, captured_at TEXT NOT NULL);
    CREATE TABLE test_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, command TEXT NOT NULL, cwd TEXT NOT NULL, targeted INTEGER NOT NULL, exit_code INTEGER, passed INTEGER, stdout TEXT NOT NULL, stderr TEXT NOT NULL, duration INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE repair_attempts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, attempt_number INTEGER NOT NULL, test_run_id TEXT, diagnosis TEXT NOT NULL, evidence TEXT NOT NULL, change_ids TEXT NOT NULL, approval_status TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE task_memory (session_id TEXT PRIMARY KEY, summary TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE task_summaries (session_id TEXT PRIMARY KEY, task TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE execution_checkpoints (session_id TEXT PRIMARY KEY, state TEXT NOT NULL, iteration INTEGER NOT NULL, tool_calls INTEGER NOT NULL, checkpoint TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE change_batches (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, workspace_id TEXT NOT NULL, status TEXT NOT NULL, failure_reason TEXT, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT);
    CREATE TABLE change_batch_items (batch_id TEXT NOT NULL, change_id TEXT NOT NULL, path TEXT NOT NULL, original_hash TEXT NOT NULL, proposed_hash TEXT NOT NULL, original_content TEXT NOT NULL, proposed_content TEXT NOT NULL, backup_content TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY (batch_id, change_id));
  `);
  return new DatabaseStore(db);
}

test("IPC Matrix: Input validation rejects malformed types, empty strings, and oversized buffers", () => {
  assert.throws(() => requireBoundedString(null, "param"), /Invalid param/);
  assert.throws(() => requireBoundedString(12345, "param"), /Invalid param/);
  assert.throws(() => requireBoundedString("", "param"), /Invalid param/);
  assert.throws(
    () => requireBoundedString("x".repeat(5000), "param", 4096),
    /Invalid param/,
  );
  assert.equal(requireBoundedString("valid", "param"), "valid");

  assert.throws(() => requireObject("string", "body"), /Invalid body/);
  assert.throws(() => requireObject([1, 2, 3], "body"), /Invalid body/);
  assert.throws(() => requireObject(null, "body"), /Invalid body/);
  assert.deepEqual(requireObject({ key: "val" }, "body"), { key: "val" });

  const actions = ["approve", "reject", "apply", "revert"] as const;
  assert.throws(() => requireAction("delete", actions), /Invalid action/);
  assert.throws(() => requireAction("", actions), /Invalid action/);
  assert.equal(requireAction("approve", actions), "approve");
});

test("IPC Matrix: Path security rejects directory traversal and symlink escapes", async () => {
  const workspace = await fs.mkdtemp(
    path.join(os.tmpdir(), "g1code-matrix-path-"),
  );
  const outside = await fs.mkdtemp(
    path.join(os.tmpdir(), "g1code-matrix-outside-"),
  );
  try {
    const sensitiveFile = path.join(outside, "secret.key");
    await fs.writeFile(sensitiveFile, "SECRET", "utf8");

    // Relative path traversal attack
    await assert.rejects(async () => {
      await safeRealPath(workspace, "../../../etc/passwd");
    }, /Path (is outside the selected workspace|escapes workspace)/);

    // Symlink escape attack
    const linkPath = path.join(workspace, "link_to_secret");
    await fs.symlink(sensitiveFile, linkPath);

    await assert.rejects(async () => {
      await safeRealPath(workspace, "link_to_secret");
    }, /Path (resolves outside|is outside) the selected workspace/);
  } finally {
    await fs
      .rm(workspace, { recursive: true, force: true })
      .catch(() => undefined);
    await fs
      .rm(outside, { recursive: true, force: true })
      .catch(() => undefined);
  }
});

test("IPC Matrix: Concurrency & State Isolation - Cross-workspace and double-approval rejection", async () => {
  const workspaceA = await fs.mkdtemp(
    path.join(os.tmpdir(), "g1code-matrix-wsA-"),
  );
  const workspaceB = await fs.mkdtemp(
    path.join(os.tmpdir(), "g1code-matrix-wsB-"),
  );
  try {
    const fileA = path.join(workspaceA, "file.ts");
    await fs.writeFile(fileA, "const a = 1;\n", "utf8");

    const store = createInMemoryStore();
    const sessionA = "session-A";
    const sessionB = "session-B";

    store.createSession({
      id: sessionA,
      workspaceId: workspaceA,
      title: "Session A",
      mode: "agent",
      model: "test-model",
      provider: "test-provider",
      status: "RUNNING",
    });

    store.createSession({
      id: sessionB,
      workspaceId: workspaceB,
      title: "Session B",
      mode: "agent",
      model: "test-model",
      provider: "test-provider",
      status: "RUNNING",
    });

    const serviceA = new ChangeService(store, workspaceA);
    const serviceB = new ChangeService(store, workspaceB);

    const changeA = await serviceA.proposeChange(
      sessionA,
      "file.ts",
      "const a = 2;\n",
    );

    // Attack: workspace B attempts to authorize or mutate change from workspace A
    assert.throws(
      () => serviceB.authorizeChange(changeA.id, sessionB),
      /Change does not belong to session and workspace/,
    );

    // Concurrency: double approval race condition
    serviceA.approveChange(changeA.id);
    assert.throws(
      () => serviceA.approveChange(changeA.id),
      /Cannot approve APPROVED change/,
    );
  } finally {
    await fs
      .rm(workspaceA, { recursive: true, force: true })
      .catch(() => undefined);
    await fs
      .rm(workspaceB, { recursive: true, force: true })
      .catch(() => undefined);
  }
});
