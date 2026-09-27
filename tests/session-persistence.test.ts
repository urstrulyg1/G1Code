import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openDatabase } from "../packages/database/connection";
import { DatabaseStore } from "../packages/database/repositories";

test("startup marks unfinished sessions interrupted instead of restoring stale execution", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "g1code-db-"));
  const db = openDatabase(dir);
  const store = new DatabaseStore(db);

  store.createSession({
    id: "running",
    workspaceId: dir,
    title: "Running",
    mode: "agent",
    model: "fake",
    provider: "fake",
    status: "RUNNING",
  });
  store.createSession({
    id: "waiting",
    workspaceId: dir,
    title: "Waiting",
    mode: "agent",
    model: "fake",
    provider: "fake",
    status: "WAITING_FOR_APPROVAL",
  });
  store.createSession({
    id: "completed",
    workspaceId: dir,
    title: "Completed",
    mode: "agent",
    model: "fake",
    provider: "fake",
    status: "COMPLETED",
  });

  store.markRunningSessionsInterrupted();

  assert.equal(store.getSession("running")?.status, "INTERRUPTED");
  assert.equal(store.getSession("waiting")?.status, "INTERRUPTED");
  assert.equal(store.getSession("completed")?.status, "COMPLETED");
  store.close();
});
