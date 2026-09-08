import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { test } from "node:test";
import { DatabaseStore } from "../packages/database/repositories";
import { ChangeService } from "../packages/tools/change-service";

function store() {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT, title TEXT, mode TEXT, model TEXT, provider TEXT, status TEXT, created_at TEXT, updated_at TEXT); CREATE TABLE file_changes (id TEXT PRIMARY KEY, session_id TEXT, path TEXT, original_hash TEXT, proposed_hash TEXT, original_content TEXT, proposed_content TEXT, applied_content TEXT, patch TEXT, status TEXT, created_at TEXT, updated_at TEXT)",
  );
  return new DatabaseStore(db);
}

test("change authorization rejects another session and workspace", async () => {
  const workspaceA = await mkdtemp(path.join(tmpdir(), "g1code-auth-a-"));
  const workspaceB = await mkdtemp(path.join(tmpdir(), "g1code-auth-b-"));
  await writeFile(path.join(workspaceA, "a.txt"), "a");
  const db = store();
  db.createSession({
    id: "session-a",
    workspaceId: workspaceA,
    title: "A",
    mode: "agent",
    model: "test",
    provider: "test",
    status: "RUNNING",
  });
  db.createSession({
    id: "session-b",
    workspaceId: workspaceB,
    title: "B",
    mode: "agent",
    model: "test",
    provider: "test",
    status: "RUNNING",
  });
  const serviceA = new ChangeService(db, workspaceA);
  const change = await serviceA.proposeChange("session-a", "a.txt", "changed");
  assert.throws(
    () => serviceA.authorizeChange(change.id, "session-b"),
    /does not belong/,
  );
  assert.throws(
    () =>
      new ChangeService(db, workspaceB).authorizeChange(change.id, "session-a"),
    /does not belong/,
  );
});
