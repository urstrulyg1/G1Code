import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { DatabaseStore } from "../packages/database/repositories";
import { ChangeService } from "../packages/tools/change-service";
import { FailureInjector, SimulatedCrashError } from "../packages/tools/failure-injector";

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

test("Crash injection: BEFORE_BATCH_PREPARE leaves filesystem untouched and fails safely", async () => {
  FailureInjector.reset();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "g1code-crash-1-"));
  try {
    const fileA = path.join(workspace, "a.txt");
    const fileB = path.join(workspace, "b.txt");
    await fs.writeFile(fileA, "original a\n", "utf8");
    await fs.writeFile(fileB, "original b\n", "utf8");

    const store = createInMemoryStore();
    const sessionId = "session-crash-1";
    store.createSession({
      id: sessionId,
      workspaceId: workspace,
      title: "Crash test 1",
      mode: "agent",
      model: "test-model",
      provider: "test-provider",
      status: "RUNNING",
    });

    const service = new ChangeService(store, workspace);
    const changeA = await service.proposeChange(sessionId, "a.txt", "proposed a\n");
    const changeB = await service.proposeChange(sessionId, "b.txt", "proposed b\n");
    service.approveChange(changeA.id);
    service.approveChange(changeB.id);

    FailureInjector.setCrashPoint("BEFORE_BATCH_PREPARE");

    await assert.rejects(
      async () => {
        await service.applyBatch(sessionId, [changeA.id, changeB.id]);
      },
      (err: Error) => err instanceof SimulatedCrashError && err.point === "BEFORE_BATCH_PREPARE",
    );

    // Files must be strictly untouched
    assert.equal(await fs.readFile(fileA, "utf8"), "original a\n");
    assert.equal(await fs.readFile(fileB, "utf8"), "original b\n");
  } finally {
    FailureInjector.reset();
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("Crash injection: BETWEEN_FILE_REPLACEMENTS rolls back cleanly and recovers on restart", async () => {
  FailureInjector.reset();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "g1code-crash-2-"));
  try {
    const fileA = path.join(workspace, "a.txt");
    const fileB = path.join(workspace, "b.txt");
    await fs.writeFile(fileA, "original a\n", "utf8");
    await fs.writeFile(fileB, "original b\n", "utf8");

    const store = createInMemoryStore();
    const sessionId = "session-crash-2";
    store.createSession({
      id: sessionId,
      workspaceId: workspace,
      title: "Crash test 2",
      mode: "agent",
      model: "test-model",
      provider: "test-provider",
      status: "RUNNING",
    });

    const service = new ChangeService(store, workspace);
    const changeA = await service.proposeChange(sessionId, "a.txt", "proposed a\n");
    const changeB = await service.proposeChange(sessionId, "b.txt", "proposed b\n");
    service.approveChange(changeA.id);
    service.approveChange(changeB.id);

    FailureInjector.setCrashPoint("BETWEEN_FILE_REPLACEMENTS");

    await assert.rejects(
      async () => {
        await service.applyBatch(sessionId, [changeA.id, changeB.id]);
      },
      /Change batch rolled back after failure/,
    );

    // Filesystem must have rolled back to original content
    assert.equal(await fs.readFile(fileA, "utf8"), "original a\n");
    assert.equal(await fs.readFile(fileB, "utf8"), "original b\n");

    // Startup recovery reconciliation
    await service.recoverActiveBatches();
    assert.equal(await fs.readFile(fileA, "utf8"), "original a\n");
    assert.equal(await fs.readFile(fileB, "utf8"), "original b\n");
  } finally {
    FailureInjector.reset();
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("Crash injection: AFTER_FILE_REPLACE reconciles to APPLIED on recovery without data loss", async () => {
  FailureInjector.reset();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "g1code-crash-3-"));
  try {
    const fileA = path.join(workspace, "a.txt");
    const fileB = path.join(workspace, "b.txt");
    await fs.writeFile(fileA, "original a\n", "utf8");
    await fs.writeFile(fileB, "original b\n", "utf8");

    const store = createInMemoryStore();
    const sessionId = "session-crash-3";
    store.createSession({
      id: sessionId,
      workspaceId: workspace,
      title: "Crash test 3",
      mode: "agent",
      model: "test-model",
      provider: "test-provider",
      status: "RUNNING",
    });

    const service = new ChangeService(store, workspace);
    const changeA = await service.proposeChange(sessionId, "a.txt", "proposed a\n");
    const changeB = await service.proposeChange(sessionId, "b.txt", "proposed b\n");
    service.approveChange(changeA.id);
    service.approveChange(changeB.id);

    FailureInjector.setCrashPoint("AFTER_FILE_REPLACE");

    await assert.rejects(
      async () => {
        await service.applyBatch(sessionId, [changeA.id, changeB.id]);
      },
      /SimulatedCrashError/,
    );

    // Both files were replaced before the crash
    assert.equal(await fs.readFile(fileA, "utf8"), "proposed a\n");
    assert.equal(await fs.readFile(fileB, "utf8"), "proposed b\n");

    // Startup recovery reconciles batch to APPLIED
    await service.recoverActiveBatches();
    const activeBatches = store.activeChangeBatches();
    assert.equal(activeBatches.length, 0); // Active batch reconciled

    assert.equal(store.getChange(changeA.id)?.status, "APPLIED");
    assert.equal(store.getChange(changeB.id)?.status, "APPLIED");
  } finally {
    FailureInjector.reset();
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
});
