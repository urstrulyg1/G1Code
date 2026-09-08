import assert from "node:assert/strict";
import { test } from "node:test";
import type { AIProvider, ChatRequest } from "../packages/ai/types";
import { AgentRuntime } from "../packages/agent/runtime";
import { ToolRegistry } from "../packages/tools/types";

test("agent pauses on pending change and resumes after explicit approval", async () => {
  let requestCount = 0;
  const provider: AIProvider = {
    getModels: async () => [],
    chat: async () => ({ message: { role: "assistant", content: "" } }),
    streamChat: async function* (_request: ChatRequest) {
      requestCount += 1;
      if (requestCount === 1) {
        yield {
          toolCalls: [
            {
              id: "change-call",
              name: "write_file",
              arguments: { path: "a.txt", content: "new" },
            },
          ],
        };
      } else {
        yield { content: "completed" };
      }
    },
  };
  const tools = new ToolRegistry();
  tools.register({
    name: "write_file",
    description: "propose a file change",
    permission: "moderate",
    inputSchema: { type: "object" },
    execute: async () => ({
      content: JSON.stringify({
        status: "pending_approval",
        changeId: "change-1",
      }),
      status: "pending_approval",
      changeId: "change-1",
    }),
  });
  let release!: (value: {
    approved: boolean;
    status: "APPLIED" | "REJECTED" | "CONFLICT";
    message: string;
  }) => void;
  const approval = new Promise<{
    approved: boolean;
    status: "APPLIED" | "REJECTED" | "CONFLICT";
    message: string;
  }>((resolve) => {
    release = resolve;
  });
  const states: string[] = [];
  const runtime = new AgentRuntime(
    provider,
    tools,
    "/workspace",
    (event) => {
      if (event.state) states.push(event.state);
    },
    async () => true,
    undefined,
    "session-1",
    undefined,
    () => approval,
  );
  const run = runtime.run("fix it", "agent");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(states.includes("WAITING_FOR_CHANGE_APPROVAL"));
  assert.equal(requestCount, 1);
  release({
    approved: true,
    status: "APPLIED",
    message: "Change applied successfully. Continuing agent.",
  });
  await run;
  assert.equal(requestCount, 2);
  assert.equal(states.at(-1), "COMPLETED");
});
