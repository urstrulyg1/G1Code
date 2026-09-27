import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { test } from "node:test";
import type { AIProvider, ChatChunk, ChatRequest } from "../packages/ai/types";
import { AgentRuntime } from "../packages/agent/runtime";
import { ToolRegistry } from "../packages/tools/types";
import { ChangeService } from "../packages/tools/change-service";
import { DatabaseStore } from "../packages/database/repositories";
import { workspaceTools } from "../packages/tools/workspace";

class CodingProvider implements AIProvider {
  readonly id = "fake";
  readonly name = "Coding Fake";
  calls = 0;
  async getModels() { return [{ id: "fake-model", name: "Fake", supportsTools: true }]; }
  async chat() { return { message: { role: "assistant" as const, content: "unused" } }; }
  supportsTools() { return true; }
  supportsVision() { return false; }
  async *streamChat(request: ChatRequest): AsyncIterable<ChatChunk> {
    this.calls++;
    if (!request.messages.some(m => m.role === "tool")) {
      yield { toolCalls: [{ id: "create-1", name: "create_file", arguments: { path: "src/agent-created.ts", content: "export const answer = 42;\n" } }] };
    } else {
      yield { content: "Created the requested file and verified the tool result." };
    }
  }
}

function makeStore() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, mode TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE file_changes (id TEXT PRIMARY KEY, session_id TEXT, path TEXT, operation TEXT NOT NULL DEFAULT 'write', target_path TEXT, original_hash TEXT, proposed_hash TEXT, original_content TEXT, proposed_content TEXT, applied_content TEXT, patch TEXT, status TEXT, created_at TEXT, updated_at TEXT);
  `);
  return new DatabaseStore(db);
}

test("real AgentRuntime can inspect a workspace tool, propose a file, await approval, and apply it", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "g1code-agent-e2e-"));
  const store = makeStore();
  const changes = new ChangeService(store, workspace);
  const registry = new ToolRegistry();
  for (const tool of workspaceTools()) registry.register(tool);
  const events: string[] = [];
  const provider = new CodingProvider();
  const runtime = new AgentRuntime(
    provider,
    registry,
    workspace,
    event => events.push(event.type + ":" + (event.toolName ?? event.state ?? "")),
    async () => true,
    { maxIterations: 5, maxToolCalls: 10, maxExecutionTime: 10000, maxRepairAttempts: 1 },
    "coding-session",
    changes,
    async changeId => {
      changes.approveChange(changeId);
      const applied = await changes.applyChange(changeId);
      return {
        approved: applied.status === "APPLIED",
        status: applied.status === "APPLIED" ? "APPLIED" : "CONFLICT",
        message: applied.status === "APPLIED" ? "Applied" : "Conflict",
      };
    },
  );

  await runtime.run("Create src/agent-created.ts with answer 42.", "agent");
  assert.equal(provider.calls, 2);
  assert.equal(await readFile(path.join(workspace, "src/agent-created.ts"), "utf8"), "export const answer = 42;\n");
  assert(events.includes("tool:create_file"));
  assert(events.some(e => e.startsWith("approval:")));
  assert(events.some(e => e === "state:COMPLETED"));
  store.close();
});
