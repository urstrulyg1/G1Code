import assert from "node:assert/strict";
import { test } from "node:test";
import type { AIProvider, ChatChunk } from "../packages/ai/types";
import { AgentRuntime } from "../packages/agent/runtime";
import { ToolRegistry } from "../packages/tools/types";

class MalformedProvider implements AIProvider {
  id = "malformed";
  name = "Malformed";

  async getModels() {
    return [];
  }

  async chat() {
    return { message: { role: "assistant" as const, content: "" } };
  }

  supportsTools() {
    return true;
  }

  supportsVision() {
    return false;
  }

  async *streamChat(): AsyncIterable<ChatChunk> {
    yield {
      toolCalls: [
        { id: "bad", name: "needs_string", arguments: { value: 42 } },
      ],
    };
  }
}

test("malformed tool arguments are rejected before tool execution", async () => {
  const provider = new MalformedProvider();
  const registry = new ToolRegistry();
  let executed = false;

  registry.register({
    name: "needs_string",
    description: "Requires a string.",
    permission: "safe",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    },
    execute: async () => {
      executed = true;
      return { content: "should not execute" };
    },
  });

  const events: Array<{ type: string; message?: string }> = [];
  const runtime = new AgentRuntime(
    provider,
    registry,
    process.cwd(),
    (event) => events.push({ type: event.type, message: event.message }),
    async () => true,
    {
      maxIterations: 2,
      maxToolCalls: 5,
      maxExecutionTime: 5000,
      maxRepairAttempts: 1,
    },
    "malformed-session",
  );

  await runtime.run("call the tool", "agent");

  assert.equal(executed, false);
  assert(
    events.some(
      (event) =>
        event.type === "error" && event.message?.includes("must be a string"),
    ),
  );
});
