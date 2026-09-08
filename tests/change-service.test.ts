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
  db.exec(
    "CREATE TABLE file_changes (id TEXT PRIMARY KEY, session_id TEXT, path TEXT, original_hash TEXT, proposed_hash TEXT, original_content TEXT, proposed_content TEXT, applied_content TEXT, patch TEXT, status TEXT, created_at TEXT, updated_at TEXT)",
  );
  return new DatabaseStore(db);
}

test("change service persists approval, apply, and safe revert lifecycle", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "g1code-change-"));
  await writeFile(path.join(workspace, "sample.txt"), "one\ntwo\n");
  const service = new ChangeService(store(), workspace);
  const change = await service.proposeChange(
    "session",
    "sample.txt",
    "one\nthree\n",
  );
  assert.equal(change.status, "PENDING");
  assert.equal(
    await readFile(path.join(workspace, "sample.txt"), "utf8"),
    "one\ntwo\n",
  );
  await service.approveChange(change.id);
  assert.equal((await service.applyChange(change.id)).status, "APPLIED");
  assert.equal(
    await readFile(path.join(workspace, "sample.txt"), "utf8"),
    "one\nthree\n",
  );
  assert.equal((await service.revertChange(change.id)).status, "REVERTED");
});

test("change service marks external edits as conflicts without overwriting them", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "g1code-conflict-"));
  const file = path.join(workspace, "sample.txt");
  await writeFile(file, "original\n");
  const service = new ChangeService(store(), workspace);
  const change = await service.proposeChange(
    "session",
    "sample.txt",
    "agent\n",
  );
  await writeFile(file, "user\n");
  await service.approveChange(change.id);
  assert.equal((await service.applyChange(change.id)).status, "CONFLICT");
  assert.equal(await readFile(file, "utf8"), "user\n");
});

test("change service rejects duplicate approval and duplicate apply", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "g1code-idempotent-"));
  await writeFile(path.join(workspace, "sample.txt"), "old\n");
  const service = new ChangeService(store(), workspace);
  const change = await service.proposeChange("session", "sample.txt", "new\n");
  await service.approveChange(change.id);
  assert.throws(
    () => service.approveChange(change.id),
    /already decided|Cannot approve/,
  );
  const first = await service.applyChange(change.id);
  assert.equal(first.status, "APPLIED");
  await assert.rejects(
    () => service.applyChange(change.id),
    /must be approved|already approved|already being/,
  );
});
