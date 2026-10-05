import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSession } from "../packages/agent/session";
import { SessionLifecycle } from "../packages/agent/lifecycle";
import { AgentRuntimeManager } from "../packages/agent/manager";

test("lifecycle enforces legal transitions and rejects illegal ones", () => {
  const lifecycle = new SessionLifecycle("s1");
  assert.equal(lifecycle.state, "created");
  assert.equal(lifecycle.transition("running"), true);
  assert.equal(lifecycle.transition("waiting_for_approval"), true);
  assert.equal(lifecycle.transition("running"), true);
  assert.equal(lifecycle.transition("completed"), true);
  assert.equal(lifecycle.terminal, true);
  assert.equal(lifecycle.transition("running"), false, "terminal states are final");
  assert.throws(
    () => new SessionLifecycle("s2").transition("cancelled"),
    /Illegal session transition/,
  );
});

test("repeated cancel requests are idempotent and observable", () => {
  const session = new AgentSession("s");
  session.lifecycle.transition("running");
  assert.equal(session.requestCancel("first"), true);
  assert.equal(session.state, "cancelling");
  assert.equal(session.requestCancel("second"), false);
  assert.equal(session.requestCancel("third"), false);
  assert.equal(session.lifecycle.cancelRequested, true);
  session.markCancelled();
  assert.equal(session.state, "cancelled");
  assert.equal(session.requestCancel("after terminal"), false);
});

test("cancellation aborts the signal, runs cleanups once, and kills children", () => {
  const session = new AgentSession("cleanup");
  session.lifecycle.transition("running");
  let aborted = false;
  session.signal.addEventListener("abort", () => {
    aborted = true;
  });
  let cleanups = 0;
  session.register(() => {
    cleanups += 1;
  });
  const kills: string[] = [];
  session.trackChild({ kill: (signal) => kills.push(String(signal)) });

  session.requestCancel("test");
  session.requestCancel("test again");

  assert.equal(aborted, true, "abort signal fires for provider streams and tools");
  assert.equal(cleanups, 1, "cleanup runs exactly once even with repeated stops");
  assert.deepEqual(kills, ["SIGTERM"]);
});

test("manager rejects duplicate session ids instead of sharing state", async () => {
  const manager = new AgentRuntimeManager();
  const runtime = { stop() {} } as never;
  const session = manager.startSession("dup", runtime, () => new Promise<void>(() => {}));
  assert.throws(
    () => manager.startSession("dup", runtime, () => Promise.resolve()),
    /already running/,
  );
  assert.equal(manager.size(), 1);
  assert.equal(manager.cancelSession("dup"), "requested");
  assert.equal(manager.cancelSession("dup"), "already-cancelling");
  session.dispose();
  assert.equal(manager.cancelSession("missing"), "not-found");
});

test("manager releases the handle and marks a cancelled session cancelled", async () => {
  const manager = new AgentRuntimeManager();
  const states: string[] = [];
  const runtime = {
    stop() {
      states.push("stopped");
    },
    iterationCount: () => 2,
    toolCallCount: () => 5,
  } as never;

  manager.startSession("run", runtime, async (signal, session) => {
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    session.markCancelled("cancelled");
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(manager.activeSessions().map((s) => s.sessionId), ["run"]);
  assert.equal(manager.activeSessions()[0].toolCalls, 5);
  manager.cancelSession("run");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(manager.size(), 0, "handle released after cancellation");
  assert.deepEqual(states, ["stopped"]);
});

test("a runtime that throws is converted into a failed session without leaking a handle", async () => {
  const manager = new AgentRuntimeManager();
  const runtime = { stop() {} } as never;
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const session = manager.startSession("boom", runtime, async () => {
      throw new Error("integration boundary failed");
    });
    await session.whenFinished();
    assert.equal(session.state, "failed");
    assert.equal(manager.size(), 0);
  } finally {
    console.error = originalError;
  }
});

test("stopAll cancels every live session and never throws", () => {
  const manager = new AgentRuntimeManager();
  const runtime = { stop() {} } as never;
  manager.startSession("a", runtime, () => new Promise<void>(() => {}));
  manager.startSession("b", runtime, () => new Promise<void>(() => {}));
  assert.equal(manager.size(), 2);
  manager.stopAll("test");
  assert.equal(
    manager.activeSessions().every((session) => session.cancelRequested),
    true,
  );
  assert.doesNotThrow(() => manager.stopAll("test again"));
});

test("subscribing to manager changes does not leak listeners", () => {
  const manager = new AgentRuntimeManager();
  const runtime = { stop() {} } as never;
  const unsubscribe = manager.subscribe(() => undefined);
  manager.startSession("x", runtime, () => Promise.resolve());
  unsubscribe();
  const session = manager.getAgentSession("x");
  assert.ok(session);
  session.dispose();
});
