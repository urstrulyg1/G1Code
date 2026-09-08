import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentRuntime } from "../packages/agent/runtime";
import { ToolRegistry } from "../packages/tools/types";
import type { AIProvider } from "../packages/ai/types";

test("agent bounds repeated failing test repairs", async () => {
  let calls = 0;
  const provider: AIProvider = {
    getModels: async () => [],
    chat: async () => ({ message: { role: "assistant", content: "" } }),
    streamChat: async function* () {
      calls += 1;
      yield {
        toolCalls: [
          { id: `test-${calls}`, name: "run_tests", arguments: { paths: [] } },
        ],
      };
    },
  };
  const tools = new ToolRegistry();
  tools.register({
    name: "run_tests",
    description: "test",
    permission: "safe",
    inputSchema: { type: "object" },
    execute: async () => ({
      content: "tests failed",
      isError: true,
      exitCode: 1,
    }),
  });
  const states: string[] = [];
  await new AgentRuntime(
    provider,
    tools,
    "/workspace",
    (event) => {
      if (event.state) states.push(event.state);
    },
    async () => true,
    undefined,
    "session",
  ).run("test", "agent");
  assert.ok(states.includes("DIAGNOSING"));
  assert.ok(states.includes("REPAIRING"));
  assert.equal(states.at(-1), "FAILED");
  assert.equal(calls, 5);
});
