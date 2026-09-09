import assert from "node:assert/strict";
import { test } from "node:test";
import { redactSecrets, redactObject } from "../packages/security/redaction";
import { workspaceTools } from "../packages/tools/workspace";
import Database from "better-sqlite3";
import { DatabaseStore } from "../packages/database/repositories";

test("redactSecrets sanitizes Bearer tokens, Authorization headers, and API keys", () => {
  const input1 = "Authorization: Bearer mySecretToken123456789";
  const out1 = redactSecrets(input1);
  assert.equal(out1, "Authorization: Bearer ********");

  const input2 = "Here is the key: apiKey='sk-proj-998877665544332211'";
  const out2 = redactSecrets(input2);
  assert.ok(!out2.includes("sk-proj-998877665544332211"));
  assert.ok(out2.includes("********"));

  const input3 = 'EXPLABS_API_KEY="explabs-secret-token-abcdef123"';
  const out3 = redactSecrets(input3);
  assert.ok(!out3.includes("explabs-secret-token-abcdef123"));
  assert.ok(out3.includes("********"));

  const input4 = "password: 'SuperSecretPassword123!'";
  const out4 = redactSecrets(input4);
  assert.ok(!out4.includes("SuperSecretPassword123!"));
  assert.ok(out4.includes("********"));
});

test("redactSecrets sanitizes RSA / OpenSSH private keys", () => {
  const privateKey = `
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y123456789abcdefghijklmnopqrstuvwxyz
ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890+/==
-----END RSA PRIVATE KEY-----
  `.trim();
  const redacted = redactSecrets(privateKey);
  assert.ok(!redacted.includes("MIIEowIBAAKCAQEA0Y123456789"));
  assert.ok(redacted.includes("-----BEGIN PRIVATE KEY-----"));
  assert.ok(redacted.includes("********"));
  assert.ok(redacted.includes("-----END PRIVATE KEY-----"));
});

test("redactObject deeply sanitizes nested objects and arrays", () => {
  const payload = {
    command:
      "curl -H 'Authorization: Bearer secrettoken123' https://api.example.com",
    config: {
      apiKey: "sk-secret999999999",
      secretKey: "very-secret-value",
      safeValue: "public-info",
    },
    items: [
      { name: "item1", token: "bearer-token-12345" },
      { name: "item2", note: "regular note" },
    ],
  };

  const clean = redactObject(payload);
  assert.ok(!JSON.stringify(clean).includes("secrettoken123"));
  assert.ok(!JSON.stringify(clean).includes("sk-secret999999999"));
  assert.ok(!JSON.stringify(clean).includes("very-secret-value"));
  assert.equal(clean.config.safeValue, "public-info");
  assert.equal(clean.items[1].note, "regular note");
  assert.equal(clean.config.apiKey, "********");
});

test("workspace run_command emits structured events with toolCallId, duration, and exitCode", async () => {
  const tools = workspaceTools();
  const runCommandTool = tools.find((t) => t.name === "run_command");
  assert.ok(runCommandTool, "run_command tool should exist");

  const emittedEvents: Array<{
    type: string;
    toolCallId?: string;
    action?: string;
    command?: string;
    exitCode?: number;
    duration?: number;
  }> = [];

  const context: any = {
    workspace: process.cwd(),
    toolCallId: "call_test_123",
    approve: async () => true,
    emit: (ev: any) => emittedEvents.push(ev),
  };

  const result = await runCommandTool.execute(
    { command: "echo 'G1Code Execution Experience'", cwd: "." },
    context,
  );

  assert.equal(result.isError, false);
  assert.equal(result.exitCode, 0);
  assert.ok(result.duration !== undefined && result.duration >= 0);
  assert.ok(result.stdout?.includes("G1Code Execution Experience"));

  // Verify started event was emitted with toolCallId
  const started = emittedEvents.find((e) => e.action === "started");
  assert.ok(started, "Started event should be emitted");
  assert.equal(started.toolCallId, "call_test_123");
  assert.equal(started.command, "echo 'G1Code Execution Experience'");

  // Verify completed event was emitted with exitCode and duration
  const completed = emittedEvents.find((e) => e.action === "completed");
  assert.ok(completed, "Completed event should be emitted");
  assert.equal(completed.toolCallId, "call_test_123");
  assert.equal(completed.exitCode, 0);
  assert.ok(completed.duration !== undefined);
});

test("workspace run_command redacts secrets in stdout stream and final output", async () => {
  const tools = workspaceTools();
  const runCommandTool = tools.find((t) => t.name === "run_command")!;

  const emittedEvents: any[] = [];
  const context: any = {
    workspace: process.cwd(),
    toolCallId: "call_secret_test",
    approve: async () => true,
    emit: (ev: any) => emittedEvents.push(ev),
  };

  // Run command that prints secret token
  const result = await runCommandTool.execute(
    {
      command: "echo 'Authorization: Bearer super-secret-token-12345'",
      cwd: ".",
    },
    context,
  );

  assert.ok(!result.stdout?.includes("super-secret-token-12345"));
  assert.ok(result.stdout?.includes("Bearer ********"));

  for (const ev of emittedEvents) {
    if (ev.chunk) {
      assert.ok(!ev.chunk.includes("super-secret-token-12345"));
    }
  }
});

test("read_file returns lineCount and search_files returns matchesCount", async () => {
  const tools = workspaceTools();
  const readFileTool = tools.find((t) => t.name === "read_file")!;
  const searchFilesTool = tools.find((t) => t.name === "search_files")!;

  const context: any = {
    workspace: process.cwd(),
    approve: async () => true,
    emit: () => {},
  };

  const readResult = await readFileTool.execute(
    { path: "package.json" },
    context,
  );
  assert.ok(readResult.lineCount !== undefined && readResult.lineCount > 10);
  assert.ok(readResult.path === "package.json");

  const searchResult = await searchFilesTool.execute(
    { query: "g1code", path: "." },
    context,
  );
  assert.ok(
    searchResult.matchesCount !== undefined && searchResult.matchesCount > 0,
  );
});

test("database stores and restores command events and tool calls for session replay", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, mode TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(session_id) REFERENCES sessions(id));
    CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT, tool_name TEXT NOT NULL, arguments TEXT NOT NULL, result TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT);
    CREATE TABLE IF NOT EXISTS agent_events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, timestamp TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS file_changes (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, path TEXT NOT NULL, original_hash TEXT NOT NULL, proposed_hash TEXT NOT NULL, original_content TEXT NOT NULL DEFAULT '', proposed_content TEXT NOT NULL DEFAULT '', applied_content TEXT, patch TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  const store = new DatabaseStore(db);

  const sessionId = `sess-persist-${Date.now()}`;
  store.createSession({
    id: sessionId,
    workspaceId: process.cwd(),
    title: "Test Antigravity Command Session",
    mode: "agent",
    model: "claude-3-5-sonnet",
    provider: "anthropic",
    status: "RUNNING",
  });

  // Emulate tool start
  const toolCallEvent = {
    id: "evt-1",
    sessionId,
    at: new Date().toISOString(),
    type: "tool",
    toolCallId: "call_abc",
    toolName: "run_command",
    input: { command: "npm test", cwd: "." },
    message: "Running run_command",
  };
  store.addEvent(sessionId, "tool", toolCallEvent);

  // Emulate command completed event
  const cmdCompletedEvent = {
    id: "evt-2",
    sessionId,
    at: new Date().toISOString(),
    type: "command",
    toolCallId: "call_abc",
    action: "completed",
    command: "npm test",
    exitCode: 0,
    duration: 3500,
    message: "COMMAND_COMPLETED exit 0",
  };
  store.addEvent(sessionId, "command", cmdCompletedEvent);

  // Emulate tool result event
  const toolResultEvent = {
    id: "evt-3",
    sessionId,
    at: new Date().toISOString(),
    type: "tool",
    toolCallId: "call_abc",
    toolName: "run_command",
    result: {
      stdout: "Tests passed 24/24",
      stderr: "",
      exitCode: 0,
      duration: 3500,
    },
    message: "run_command completed",
  };
  store.addEvent(sessionId, "tool", toolResultEvent);

  // Reopen / load events
  const loadedEvents = store.sessionEvents(sessionId);
  assert.equal(loadedEvents.length, 3);

  const replayedCmd = loadedEvents.find(
    (e) => (e.payload as any).type === "command",
  );
  assert.ok(replayedCmd);
  assert.equal((replayedCmd.payload as any).exitCode, 0);
  assert.equal((replayedCmd.payload as any).duration, 3500);

  const replayedResult = loadedEvents.find(
    (e) => (e.payload as any).result?.stdout,
  );
  assert.ok(replayedResult);
  assert.equal(
    (replayedResult.payload as any).result.stdout,
    "Tests passed 24/24",
  );
});
