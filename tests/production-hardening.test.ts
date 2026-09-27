import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { AgentRuntime } from "../packages/agent/runtime";
import { ToolRegistry } from "../packages/tools/types";
import { saveSettings } from "../packages/settings/storage";
import { spawnCommand } from "../packages/tools/command";

test("agent events carry a request id and strict monotonic sequence", async () => {
  const events: any[] = [];
  const provider = {
    async getModels() {
      return [];
    },
    supportsTools() {
      return true;
    },
    async chat() {
      throw new Error("not used");
    },
    async *streamChat() {
      yield { content: "hello " };
      yield { content: "world" };
    },
  };
  const runtime = new AgentRuntime(
    provider as any,
    new ToolRegistry(),
    process.cwd(),
    (event) => events.push(event),
    async () => true,
    undefined,
    "session-test",
    undefined,
    undefined,
    undefined,
    undefined,
    "test-model",
    "request-test",
  );

  await runtime.run("hello", "agent");
  const emitted = events.filter((e) => e.requestId === "request-test");
  assert.ok(emitted.length >= 3);
  assert.ok(emitted.every((e) => e.sessionId === "session-test"));
  assert.deepEqual(
    emitted.map((e) => e.seq),
    Array.from({ length: emitted.length }, (_, i) => i + 1),
  );
});

test("settings reject invalid execution modes and clamp dangerous limits", async () => {
  const dir = await mkdtemp(`${tmpdir()}/g1code-settings-`);
  try {
    await assert.rejects(
      () => saveSettings({ agentMode: "unsafe" as any }, dir),
      /Invalid agentMode/,
    );
    const saved = await saveSettings(
      {
        agentMode: "auto",
        maxAgentSteps: 99999,
        maxRetries: 99,
        commandTimeoutMs: 1,
        contextBudgetChars: 9999999,
        toolPermissions: { deleteFiles: true } as any,
      },
      dir,
    );
    assert.equal(saved.agentMode, "auto");
    assert.equal(saved.maxAgentSteps, 200);
    assert.equal(saved.maxRetries, 8);
    assert.equal(saved.commandTimeoutMs, 1000);
    assert.equal(saved.contextBudgetChars, 500000);
    assert.equal(saved.toolPermissions.deleteFiles, true);
    assert.equal(saved.toolPermissions.runCommands, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("command cancellation terminates the spawned process promptly", async () => {
  const controller = new AbortController();
  const execution = spawnCommand(
    'node -e "setTimeout(() => {}, 30000)"',
    process.cwd(),
    controller.signal,
    10000,
  );
  setTimeout(() => controller.abort(), 100);
  const result = await execution.wait();
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.duration < 5000, `cancellation took ${result.duration}ms`);
});
