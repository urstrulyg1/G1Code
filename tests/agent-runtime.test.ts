import assert from "node:assert/strict";
import { test } from "node:test";
import type { AIProvider, ChatChunk, ChatRequest } from "../packages/ai/types";
import { AgentRuntime } from "../packages/agent/runtime";
import { ToolRegistry } from "../packages/tools/types";

class FakeProvider implements AIProvider {
  readonly id = "fake";
  readonly name = "Fake";
  calls: ChatRequest[] = [];

  async getModels() { return [{ id: "fake-model", name: "Fake Model", supportsTools: true }]; }
  async chat() {
    return { message: { role: "assistant" as const, content: "unused" } };
  }
  supportsTools() { return true; }
  supportsVision() { return false; }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatChunk> {
    this.calls.push(request);
    const hasToolResult = request.messages.some((m) => m.role === "tool");
    if (!hasToolResult) {
      yield { content: "Hello " };
      yield { content: "world" };
      return;
    }
    yield { content: "Tool result received." };
  }
}

function runtimeFor(
  sessionId: string,
  provider: AIProvider,
  registry: ToolRegistry,
  events: Array<{ sessionId: string; type: string; state?: string; message?: string }>,
  limits = { maxIterations: 10, maxToolCalls: 20, maxExecutionTime: 10_000, maxRepairAttempts: 2 },
) {
  return new AgentRuntime(
    provider,
    registry,
    process.cwd(),
    (event) => events.push({ sessionId, type: event.type, state: event.state, message: event.message }),
    async () => true,
    limits,
    sessionId,
  );
}

test("agent streams ordered chunks and completes exactly once", async () => {
  const provider = new FakeProvider();
  const registry = new ToolRegistry();
  const events: Array<{ sessionId: string; type: string; state?: string; message?: string }> = [];
  const runtime = runtimeFor("session-a", provider, registry, events);

  await runtime.run("hello", "ask");

  const text = events.filter((e) => e.type === "text").map((e) => e.message).join("");
  assert.equal(text, "Hello world");
  assert.equal(events.filter((e) => e.type === "done").length, 1);
  assert.equal(events.filter((e) => e.state === "COMPLETED").length, 1);
});

test("cancelling during a tool execution stops the run and propagates the signal", async () => {
  const provider = new FakeProvider();
  let toolStarted = false;
  let toolCancelled = false;
  const registry = new ToolRegistry();
  registry.register({
    name: "slow_tool",
    description: "Waits until cancelled.",
    permission: "safe",
    inputSchema: { type: "object" },
    execute: async (_input, context) => {
      toolStarted = true;
      await new Promise<void>((resolve) => {
        const signal = context.signal;
        if (!signal) return resolve();
        if (signal.aborted) return resolve();
        signal.addEventListener("abort", () => {
          toolCancelled = true;
          resolve();
        }, { once: true });
      });
      return { content: "cancelled" };
    },
  });

  provider.streamChat = async function* () {
    yield {
      toolCalls: [{ id: "tool-1", name: "slow_tool", arguments: {} }],
    };
  };

  const events: Array<{ sessionId: string; type: string; state?: string; message?: string }> = [];
  const runtime = runtimeFor("cancel-session", provider, registry, events);
  const controller = new AbortController();
  const run = runtime.run("cancel me", "agent", controller.signal);

  while (!toolStarted) await new Promise((resolve) => setTimeout(resolve, 1));
  controller.abort();
  await run;

  assert.equal(toolCancelled, true);
  assert(events.some((e) => e.state === "CANCELLED" || e.state === "STOPPED"));
  assert.equal(events.filter((e) => e.state === "COMPLETED").length, 0);
});

test("two concurrent sessions keep their event streams isolated", async () => {
  const providerA = new FakeProvider();
  const providerB = new FakeProvider();
  const registry = new ToolRegistry();
  const eventsA: Array<{ sessionId: string; type: string; state?: string; message?: string }> = [];
  const eventsB: Array<{ sessionId: string; type: string; state?: string; message?: string }> = [];

  await Promise.all([
    runtimeFor("A", providerA, registry, eventsA).run("A", "ask"),
    runtimeFor("B", providerB, registry, eventsB).run("B", "ask"),
  ]);

  assert(eventsA.length > 0 && eventsB.length > 0);
  assert(eventsA.every((event) => event.sessionId === "A"));
  assert(eventsB.every((event) => event.sessionId === "B"));
  assert.equal(eventsA.some((event) => event.message?.includes("Tool result")), false);
  assert.equal(eventsB.some((event) => event.message?.includes("Tool result")), false);
});
