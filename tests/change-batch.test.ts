import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { test } from "node:test";
import { DatabaseStore } from "../packages/database/repositories";
import { ChangeService } from "../packages/tools/change-service";

function store() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT, title TEXT, mode TEXT, model TEXT, provider TEXT, status TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE file_changes (id TEXT PRIMARY KEY, session_id TEXT, path TEXT, original_hash TEXT, proposed_hash TEXT, original_content TEXT, proposed_content TEXT, applied_content TEXT, patch TEXT, status TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE change_batches (id TEXT PRIMARY KEY, session_id TEXT, workspace_id TEXT, status TEXT, failure_reason TEXT, created_at TEXT, started_at TEXT, completed_at TEXT);
    CREATE TABLE change_batch_items (batch_id TEXT, change_id TEXT, path TEXT, original_hash TEXT, proposed_hash TEXT, original_content TEXT, proposed_content TEXT, backup_content TEXT, status TEXT, PRIMARY KEY(batch_id, change_id));`);
  return new DatabaseStore(db);
}

test("multi-file batch applies all prepared files and persists journal", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "g1code-batch-"));
  await writeFile(path.join(workspace, "a.txt"), "a\n");
  await writeFile(path.join(workspace, "b.txt"), "b\n");
  const database = store();
  database.createSession({ id: "session", workspaceId: workspace, title: "batch", mode: "agent", model: "test", provider: "test", status: "RUNNING" });
  const service = new ChangeService(database, workspace);
  const a = await service.proposeChange("session", "a.txt", "A\n");
  const b = await service.proposeChange("session", "b.txt", "B\n");
  service.approveChange(a.id);
  service.approveChange(b.id);
  const result = await service.applyBatch("session", [a.id, b.id]);
  assert.equal(result.batch?.status, "APPLIED");
  assert.equal(await readFile(path.join(workspace, "a.txt"), "utf8"), "A\n");
  assert.equal(await readFile(path.join(workspace, "b.txt"), "utf8"), "B\n");
  assert.equal(database.changeBatchItems(result.batch!.id).length, 2);
});

test("multi-file batch preflight conflict leaves every file unchanged", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "g1code-batch-conflict-"));
  await writeFile(path.join(workspace, "a.txt"), "a\n");
  await writeFile(path.join(workspace, "b.txt"), "b\n");
  const database = store();
  database.createSession({ id: "session", workspaceId: workspace, title: "batch", mode: "agent", model: "test", provider: "test", status: "RUNNING" });
  const service = new ChangeService(database, workspace);
  const a = await service.proposeChange("session", "a.txt", "A\n");
  const b = await service.proposeChange("session", "b.txt", "B\n");
  service.approveChange(a.id);
  service.approveChange(b.id);
  await writeFile(path.join(workspace, "b.txt"), "user\n");
  await assert.rejects(() => service.applyBatch("session", [a.id, b.id]), /conflict/);
  assert.equal(await readFile(path.join(workspace, "a.txt"), "utf8"), "a\n");
  assert.equal(await readFile(path.join(workspace, "b.txt"), "utf8"), "user\n");
});
