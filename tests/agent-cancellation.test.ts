import assert from "node:assert/strict";
import { test } from "node:test";
import type { AIProvider, ChatChunk, ChatRequest } from "../packages/ai/types";
import { AgentRuntime, type AgentEvent } from "../packages/agent/runtime";
import { AgentSession } from "../packages/agent/session";
import { AgentRuntimeManager } from "../packages/agent/manager";
import { ToolRegistry } from "../packages/tools/types";

class StreamingProvider implements AIProvider {
  readonly id = "streaming";
  started = false;
  aborted = false;
  readonly seenSignals: Array<AbortSignal | undefined> = [];

  async getModels() {
    return [{ id: "model", name: "Model", supportsTools: true }];
  }
  async chat() {
    return { message: { role: "assistant" as const, content: "" } };
  }
  supportsTools() {
    return true;
  }
  async *streamChat(request: ChatRequest): AsyncIterable<ChatChunk> {
    this.seenSignals.push(request.signal);
    this.started = true;
    yield { content: "partial " };
    await new Promise<void>((resolve) => {
      const signal = request.signal;
      if (!signal) return resolve();
      if (signal.aborted) {
        // Cancellation arrived before this stream attached its listener: the
        // stream still observes an aborted signal, so record it.
        this.aborted = true;
        return resolve();
      }
      signal.addEventListener(
        "abort",
        () => {
          this.aborted = true;
          resolve();
        },
        { once: true },
      );
    });
    throw new Error("stream aborted by signal");
  }
}

const limits = {
  maxIterations: 5,
  maxToolCalls: 10,
  maxExecutionTime: 5_000,
  maxRepairAttempts: 1,
};

function collect() {
  const events: AgentEvent[] = [];
  return { events, emit: (event: AgentEvent) => events.push(event) };
}

/**
 * Wait for an observable condition instead of sleeping for a fixed number of
 * milliseconds. CI runners are slow and shared, so fixed sleeps make
 * cancellation tests flaky; polling keeps the same assertions but removes the
 * scheduling assumption.
 */
async function waitFor(
  condition: () => boolean,
  description: string,
  timeoutMs = 10_000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out after ${timeoutMs}ms waiting for ${description}`);
}

test("cancellation during provider streaming aborts the request and ends the session", async () => {
  const provider = new StreamingProvider();
  const { events, emit } = collect();
  const runtime = new AgentRuntime(
    provider,
    new ToolRegistry(),
    process.cwd(),
    emit,
    async () => true,
    limits,
    "stream-session",
  );
  const session = new AgentSession("stream-session");
  runtime.attachSession(session);

  const run = runtime.run("long task", "ask");
  await waitFor(
    () => provider.started && provider.seenSignals.length > 0,
    "the provider stream to start",
  );
  assert.equal(provider.started, true);
  assert.equal(session.state, "running");

  session.requestCancel("user pressed stop");
  await run;

  assert.equal(provider.aborted, true, "provider stream observed the abort");
  assert.equal(session.state, "cancelled");
  const states = events.filter((event) => event.type === "lifecycle");
  assert.deepEqual(
    states.map((event) => event.lifecycle),
    ["running", "cancelling", "cancelled"],
  );
  assert.equal(events.filter((event) => event.type === "done").length, 0);
  // Partial text that arrived before the abort is still surfaced once.
  assert.equal(
    events.filter((event) => event.type === "text").length <= 1,
    true,
    "coalesced text is emitted at most once",
  );
});

test("cancellation during tool execution stops the tool through the session signal", async () => {
  const provider = new StreamingProvider();
  provider.streamChat = async function* () {
    yield { toolCalls: [{ id: "t1", name: "slow_tool", arguments: {} }] };
  };
  const registry = new ToolRegistry();
  let cancelled = false;
  let toolStarted = false;
  registry.register({
    name: "slow_tool",
    description: "Waits for cancellation.",
    permission: "safe",
    inputSchema: { type: "object" },
    execute: async (_input, context) => {
      toolStarted = true;
      await new Promise<void>((resolve) => {
        const signal = context.signal;
        if (!signal || signal.aborted) return resolve();
        signal.addEventListener(
          "abort",
          () => {
            cancelled = true;
            resolve();
          },
          { once: true },
        );
      });
      return { content: "cancelled" };
    },
  });

  const { events, emit } = collect();
  const runtime = new AgentRuntime(
    provider,
    registry,
    process.cwd(),
    emit,
    async () => true,
    limits,
    "tool-session",
  );
  const session = new AgentSession("tool-session");
  runtime.attachSession(session);
  const run = runtime.run("use a tool", "agent");
  await waitFor(() => toolStarted, "the tool to start");

  session.requestCancel("stop during tool");
  await run;

  assert.equal(cancelled, true);
  assert.equal(session.state, "cancelled");
});

test("cancellation while waiting for approval resolves the waiter and never hangs", async () => {
  const provider = new StreamingProvider();
  provider.streamChat = async function* () {
    yield { toolCalls: [{ id: "t1", name: "delete_file", arguments: {} }] };
  };
  const registry = new ToolRegistry();
  let executed = false;
  registry.register({
    name: "delete_file",
    description: "Never runs because approval is cancelled.",
    permission: "dangerous",
    inputSchema: { type: "object" },
    execute: async () => {
      executed = true;
      return { content: "deleted" };
    },
  });

  const { events, emit } = collect();
  let approvalRequested = false;
  const runtime = new AgentRuntime(
    provider,
    registry,
    process.cwd(),
    emit,
    async () => {
      approvalRequested = true;
      // Never resolves: only cancellation can end this wait.
      return new Promise<boolean>(() => undefined);
    },
    limits,
    "approval-session",
  );
  const session = new AgentSession("approval-session");
  runtime.attachSession(session);

  const run = runtime.run("delete something", "agent");
  await waitFor(() => approvalRequested, "the approval request");
  assert.equal(approvalRequested, true);
  assert.equal(session.state, "waiting_for_approval");

  session.requestCancel("stop while waiting");
  await Promise.race([
    run,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("approval wait did not unwind")),
        10_000,
      ),
    ),
  ]);

  assert.equal(executed, false, "a cancelled approval never runs the tool");
  assert.equal(session.state, "cancelled");
  const approval = events
    .filter((event) => event.type === "approval")
    .map((event) => (event.result as { status?: string } | undefined)?.status);
  assert.ok(approval.includes("REJECTED"));
  assert.equal(
    session.signal.aborted,
    true,
    "no orphaned approval listener remains",
  );
});

test("repeated stop requests during a run are safe and produce a single terminal state", async () => {
  const provider = new StreamingProvider();
  const { events, emit } = collect();
  const runtime = new AgentRuntime(
    provider,
    new ToolRegistry(),
    process.cwd(),
    emit,
    async () => true,
    limits,
    "repeat-session",
  );
  const session = new AgentSession("repeat-session");
  runtime.attachSession(session);
  const run = runtime.run("task", "ask");
  await waitFor(() => provider.started, "the provider stream to start");

  runtime.stop();
  runtime.stop();
  runtime.stop();
  session.requestCancel("again");
  await run;

  assert.equal(session.state, "cancelled");
  assert.equal(
    events.filter((event) => event.lifecycle === "cancelled").length,
    1,
    "cancellation is reported exactly once",
  );
});

test("manager cancellation during an in-flight run unwinds provider and tools", async () => {
  const provider = new StreamingProvider();
  const { events, emit } = collect();
  const runtime = new AgentRuntime(
    provider,
    new ToolRegistry(),
    process.cwd(),
    emit,
    async () => true,
    limits,
    "manager-session",
  );
  const manager = new AgentRuntimeManager();
  manager.startSession("manager-session", runtime, async (signal, session) => {
    runtime.attachSession(session);
    await runtime.run("task", "ask", signal);
  });
  await waitFor(() => provider.started, "the provider stream to start");

  assert.equal(manager.cancelSession("manager-session"), "requested");
  await waitFor(
    () => manager.size() === 0,
    "the manager to release the cancelled session",
  );

  assert.equal(manager.size(), 0, "no session handle is leaked");
  assert.equal(provider.aborted, true);
  assert.equal(
    events.some((event) => event.lifecycle === "cancelled"),
    true,
  );
});
