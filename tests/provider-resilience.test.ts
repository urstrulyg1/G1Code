import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenAICompatibleProvider } from "../packages/ai/providers/openai-compatible";
import { AgentRuntime } from "../packages/agent/runtime";
import { ToolRegistry } from "../packages/tools/types";
import { workspaceTools } from "../packages/tools/workspace";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

test("Provider Resilience: Normalizes HTTP 429 Rate Limits and 500 Server Errors", async () => {
  const originalFetch = globalThis.fetch;
  try {
    // 429 Rate Limit
    globalThis.fetch = async () =>
      new Response("Rate limit exceeded", { status: 429 });
    await assert.rejects(
      new OpenAICompatibleProvider("https://example.test/v1", "secret").chat({
        model: "m",
        messages: [{ role: "user", content: "hi" }],
      }),
      /Provider request failed \(429\)/,
    );

    // 500 Server Error
    globalThis.fetch = async () =>
      new Response("Internal Server Error", { status: 500 });
    await assert.rejects(
      new OpenAICompatibleProvider("https://example.test/v1", "secret").chat({
        model: "m",
        messages: [{ role: "user", content: "hi" }],
      }),
      /Provider request failed \(500\)/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Provider Resilience: Unknown tool call is reported back gracefully without crashing agent", async () => {
  const workspace = await fs.mkdtemp(
    path.join(os.tmpdir(), "g1code-provider-res-"),
  );
  try {
    const registry = new ToolRegistry();
    workspaceTools().forEach((tool) => registry.register(tool));

    let iteration = 0;
    const fakeProvider = {
      getModels: async () => [{ id: "fake", name: "Fake" }],
      chat: async () => ({ content: "done" }),
      streamChat: async function* () {
        iteration++;
        if (iteration === 1) {
          // Model hallucinating an unknown tool
          yield {
            toolCalls: [
              {
                id: "call-unknown-1",
                name: "non_existent_tool_123",
                arguments: { foo: "bar" },
              },
            ],
          };
        } else {
          yield { content: "Recovered after unknown tool report" };
          yield { done: true };
        }
      },
    };

    const events: any[] = [];
    const runtime = new AgentRuntime(
      fakeProvider,
      registry,
      workspace,
      (event) => events.push(event),
      async () => true,
      {
        maxIterations: 5,
        maxToolCalls: 10,
        maxExecutionTime: 5000,
        maxRepairAttempts: 2,
      },
    );

    await runtime.run("do something", "agent");
    const completedEvent = events.find((e) => e.state === "COMPLETED");
    assert.ok(
      completedEvent,
      "Agent successfully completed after recovering from unknown tool call",
    );
  } finally {
    await fs
      .rm(workspace, { recursive: true, force: true })
      .catch(() => undefined);
  }
});

test("Provider Resilience: Malformed tool call arguments are safely bounded", async () => {
  const workspace = await fs.mkdtemp(
    path.join(os.tmpdir(), "g1code-provider-res-2-"),
  );
  try {
    const registry = new ToolRegistry();
    workspaceTools().forEach((tool) => registry.register(tool));

    let iteration = 0;
    const fakeProvider = {
      getModels: async () => [{ id: "fake", name: "Fake" }],
      chat: async () => ({ content: "done" }),
      streamChat: async function* () {
        iteration++;
        if (iteration === 1) {
          // Model calling read_file with missing or wrong type argument
          yield {
            toolCalls: [
              {
                id: "call-bad-arg",
                name: "read_file",
                arguments: { path: 9999 }, // Invalid type
              },
            ],
          };
        } else {
          yield { content: "Handled bad argument gracefully" };
          yield { done: true };
        }
      },
    };

    const events: any[] = [];
    const runtime = new AgentRuntime(
      fakeProvider,
      registry,
      workspace,
      (event) => events.push(event),
      async () => true,
      {
        maxIterations: 5,
        maxToolCalls: 10,
        maxExecutionTime: 5000,
        maxRepairAttempts: 2,
      },
    );

    await runtime.run("read a file", "agent");
    // Tool execution produces safe error event without crashing agent
    const errorEvent = events.find(
      (e) => e.type === "error" && e.toolName === "read_file",
    );
    assert.ok(
      errorEvent,
      "Malformed tool arguments produced safe error response",
    );
  } finally {
    await fs
      .rm(workspace, { recursive: true, force: true })
      .catch(() => undefined);
  }
});
