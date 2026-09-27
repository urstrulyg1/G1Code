import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { test } from "node:test";
import { DatabaseStore } from "../packages/database/repositories";
import { ChangeService } from "../packages/tools/change-service";
import {
  workspaceTools,
  safePath,
  safeRealPath,
} from "../packages/tools/workspace";

function makeStore() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, mode TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE file_changes (id TEXT PRIMARY KEY, session_id TEXT, path TEXT, operation TEXT NOT NULL DEFAULT 'write', target_path TEXT, original_hash TEXT, proposed_hash TEXT, original_content TEXT, proposed_content TEXT, applied_content TEXT, patch TEXT, status TEXT, created_at TEXT, updated_at TEXT);
  `);
  return new DatabaseStore(db);
}

function context(workspace: string, store: DatabaseStore, sessionId = "s1") {
  const service = new ChangeService(store, workspace);
  return {
    workspace,
    sessionId,
    changeService: service,
    signal: new AbortController().signal,
    toolCallId: "t1",
    approve: async () => true,
    emit: () => {},
  };
}

test("file tools create, edit, delete, rename and move through the approval-backed change service", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "g1code-file-tools-"));
  const store = makeStore();
  const tools = workspaceTools();
  const create = tools.find((t) => t.name === "create_file")!;
  const edit = tools.find((t) => t.name === "edit_file")!;
  const rename = tools.find((t) => t.name === "rename_file")!;
  const remove = tools.find((t) => t.name === "delete_file")!;

  const c = await create.execute(
    { path: "src/new.ts", content: "export const value = 1;\n" },
    context(workspace, store),
  );
  assert.equal(c.status, "pending_approval");
  await new ChangeService(store, workspace).approveChange(c.changeId!);
  assert.equal(
    (await new ChangeService(store, workspace).applyChange(c.changeId!)).status,
    "APPLIED",
  );
  assert.equal(
    await readFile(path.join(workspace, "src/new.ts"), "utf8"),
    "export const value = 1;\n",
  );

  const e = await edit.execute(
    { path: "src/new.ts", search: "value = 1", replace: "value = 2" },
    context(workspace, store),
  );
  await new ChangeService(store, workspace).approveChange(e.changeId!);
  assert.equal(
    (await new ChangeService(store, workspace).applyChange(e.changeId!)).status,
    "APPLIED",
  );
  assert.match(
    await readFile(path.join(workspace, "src/new.ts"), "utf8"),
    /value = 2/,
  );

  const r = await rename.execute(
    { path: "src/new.ts", newPath: "src/renamed.ts" },
    context(workspace, store),
  );
  await new ChangeService(store, workspace).approveChange(r.changeId!);
  assert.equal(
    (await new ChangeService(store, workspace).applyChange(r.changeId!)).status,
    "APPLIED",
  );
  await assert.rejects(() => stat(path.join(workspace, "src/new.ts")));
  assert.match(
    await readFile(path.join(workspace, "src/renamed.ts"), "utf8"),
    /value = 2/,
  );

  const d = await remove.execute(
    { path: "src/renamed.ts" },
    context(workspace, store),
  );
  await new ChangeService(store, workspace).approveChange(d.changeId!);
  assert.equal(
    (await new ChangeService(store, workspace).applyChange(d.changeId!)).status,
    "APPLIED",
  );
  await assert.rejects(() => stat(path.join(workspace, "src/renamed.ts")));
  store.close();
});

test("file operations reject workspace escapes and symlink escapes", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "g1code-file-security-"));
  assert.throws(() => safePath(workspace, "../outside"));
  assert.throws(() =>
    safePath(workspace, path.resolve(workspace, "..", "outside")),
  );
  const outside = await mkdtemp(path.join(tmpdir(), "g1code-file-outside-"));
  const { symlink } = await import("node:fs/promises");
  await symlink(
    outside,
    path.join(workspace, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  ).catch(() => {});
  await assert.rejects(() => safeRealPath(workspace, "escape/secret.txt"));
});
