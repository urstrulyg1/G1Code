import assert from "node:assert/strict";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { test } from "node:test";
import type { AIProvider, ChatRequest } from "../packages/ai/types";
import { AgentRuntime } from "../packages/agent/runtime";
import { DatabaseStore } from "../packages/database/repositories";
import { ChangeService } from "../packages/tools/change-service";
import { ToolRegistry } from "../packages/tools/types";
import { testingTools } from "../packages/testing/tool";

function createStore() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT, title TEXT, mode TEXT, model TEXT, provider TEXT, status TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, created_at TEXT);
    CREATE TABLE tool_calls (id TEXT PRIMARY KEY, session_id TEXT, message_id TEXT, tool_name TEXT, arguments TEXT, result TEXT, status TEXT, started_at TEXT, completed_at TEXT);
    CREATE TABLE agent_events (id TEXT PRIMARY KEY, session_id TEXT, event_type TEXT, payload TEXT, timestamp TEXT);
    CREATE TABLE file_changes (id TEXT PRIMARY KEY, session_id TEXT, path TEXT, original_hash TEXT, proposed_hash TEXT, original_content TEXT, proposed_content TEXT, applied_content TEXT, patch TEXT, status TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE test_runs (id TEXT PRIMARY KEY, session_id TEXT, command TEXT, cwd TEXT, targeted INTEGER, exit_code INTEGER, passed INTEGER, stdout TEXT, stderr TEXT, duration INTEGER, created_at TEXT);
    CREATE TABLE repair_attempts (id TEXT PRIMARY KEY, session_id TEXT, attempt_number INTEGER, test_run_id TEXT, diagnosis TEXT, evidence TEXT, change_ids TEXT, approval_status TEXT, result TEXT, created_at TEXT);
    CREATE TABLE task_memory (session_id TEXT PRIMARY KEY, summary TEXT, updated_at TEXT);
    CREATE TABLE task_summaries (session_id TEXT PRIMARY KEY, task TEXT, status TEXT, summary TEXT, created_at TEXT, updated_at TEXT);`);
  return new DatabaseStore(db);
}

test("golden workflow proposes, approves, tests, repairs, and retests a real fixture", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "g1code-golden-"));
  await cp(path.join(process.cwd(), "tests/fixtures/agent-project"), workspace, { recursive: true });
  const root = workspace;
  const store = createStore();
  const sessionId = "golden-session";
  store.createSession({ id: sessionId, workspaceId: root, title: "Fix calculator", mode: "agent", model: "deterministic", provider: "test", status: "RUNNING" });
  const changes = new ChangeService(store, root);
  let providerStep = 0;
  const provider: AIProvider = {
    getModels: async () => [],
    chat: async () => ({ message: { role: "assistant", content: "" } }),
    streamChat: async function* (_request: ChatRequest) {
      providerStep += 1;
      if (providerStep === 1 || providerStep === 3) {
        yield { toolCalls: [{ id: `patch-${providerStep}`, name: "apply_patch", arguments: providerStep === 1 ? { path: "src/calculator.js", search: "return a - b;", replace: "return a + 0;" } : { path: "src/calculator.js", search: "return a + 0;", replace: "return a + b;" } }] };
      } else if (providerStep === 2 || providerStep === 4) {
        yield { toolCalls: [{ id: `test-${providerStep}`, name: "run_tests", arguments: { paths: ["src/calculator.js"] } }] };
      } else {
        yield { content: "Task completed after verified repair." };
      }
    },
  };
  const registry = new ToolRegistry();
  registry.register({
    name: "apply_patch",
    description: "propose a patch",
    permission: "moderate",
    inputSchema: { type: "object" },
    execute: async (value, context) => {
      const input = value as { path: string; search: string; replace: string };
      const current = await readFile(path.join(context.workspace, input.path), "utf8");
      const change = await changes.proposeChange(sessionId, input.path, current.replace(input.search, input.replace));
      return { content: JSON.stringify({ status: "pending_approval", changeId: change.id, path: change.path }), status: "pending_approval", changeId: change.id, path: change.path, diff: change.patch };
    },
  });
  for (const tool of testingTools()) registry.register(tool);
  const events: string[] = [];
  const approvalWaiters = new Map<string, (result: { approved: boolean; status: "APPLIED" | "REJECTED" | "CONFLICT"; message: string }) => void>();
  const runtime = new AgentRuntime(provider, registry, root, (event) => {
    if (event.state) events.push(event.state);
    store.addEvent(sessionId, event.type, event);
  }, async () => true, undefined, sessionId, changes, (changeId) => new Promise((resolve) => {
    approvalWaiters.set(changeId, resolve);
    void (async () => {
      await new Promise((release) => setTimeout(release, 10));
      const pending = changes.getChange(changeId)!;
      assert.equal(pending.status, "PENDING");
      changes.approveChange(changeId);
      const applied = await changes.applyChange(changeId);
      resolve({ approved: applied.status === "APPLIED", status: applied.status === "APPLIED" ? "APPLIED" : "CONFLICT", message: applied.status === "APPLIED" ? "approved" : "conflict" });
      approvalWaiters.delete(changeId);
    })();
  }), (run) => store.addTestRun(sessionId, run));
  const run = runtime.run("Fix the calculator implementation and make sure all tests pass.", "agent");
  await Promise.race([run, new Promise((_, reject) => setTimeout(() => reject(new Error(`golden workflow timed out at provider step ${providerStep}`)), 10_000))]);
  assert.equal(await readFile(path.join(root, "src/calculator.js"), "utf8"), "export function add(a, b) {\n  return a + b;\n}\n");
  assert.ok(events.includes("WAITING_FOR_CHANGE_APPROVAL"));
  assert.ok(events.includes("COMPLETED"));
  assert.equal(store.sessionTestRuns(sessionId).length, 2);
});
