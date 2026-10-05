import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACTIVITY_LABELS,
  agentActivity,
  isTerminalEvent,
  lifecycleFromEvent,
  mergeAgentEvent,
  type Event,
} from "../apps/desktop/src/agent-events";

test("streaming text chunks are folded into one timeline row", () => {
  const first = mergeAgentEvent([], { type: "text", message: "Hel", id: "a" });
  const second = mergeAgentEvent(first, {
    type: "text",
    message: "lo",
    id: "b",
  });
  assert.equal(second.length, 1);
  assert.equal(second[0].message, "Hello");
  assert.deepEqual(second[0].eventIds, ["a", "b"]);
});

test("duplicate deliveries of the same durable event are ignored", () => {
  const merged = mergeAgentEvent(
    [{ type: "tool", id: "evt-1", toolName: "read_file" }],
    { type: "tool", id: "evt-1", toolName: "read_file" },
  );
  assert.equal(merged.length, 1);
  // Sequence numbers also protect against replayed chunks.
  const sequenced = mergeAgentEvent(
    [{ type: "text", requestId: "r1", seq: 5, message: "done" }],
    { type: "text", requestId: "r1", seq: 4, message: "older" },
  );
  assert.equal(sequenced.length, 1);
  assert.equal(sequenced[0].message, "done");
});

test("command output chunks append to the originating command row", () => {
  const start = mergeAgentEvent([], {
    type: "command",
    toolCallId: "c1",
    command: "npm test",
    action: "start",
  });
  const withOutput = mergeAgentEvent(start, {
    type: "command",
    toolCallId: "c1",
    action: "chunk",
    chunk: "ok 1",
  });
  const more = mergeAgentEvent(withOutput, {
    type: "command",
    toolCallId: "c1",
    action: "chunk",
    chunk: " - ok 2",
  });
  assert.equal(more.length, 1);
  assert.equal(more[0].chunk, "ok 1 - ok 2");
});

test("approval resolutions update the original card instead of appending", () => {
  const pending = mergeAgentEvent([], {
    type: "approval",
    changeId: "chg-1",
    message: "Approve change",
  });
  const resolved = mergeAgentEvent(pending, {
    type: "approval",
    changeId: "chg-1",
    result: { status: "APPLIED" },
  });
  assert.equal(resolved.length, 1);
  assert.deepEqual(resolved[0].result, { status: "APPLIED" });
});

test("activity classification distinguishes every user-facing activity", () => {
  const cases: Array<[Event, string]> = [
    [{ type: "text" }, "response"],
    [{ type: "reasoning" }, "thinking"],
    [{ type: "tool", toolName: "read_file" }, "tool"],
    [{ type: "command", command: "npm test" }, "command"],
    [{ type: "approval" }, "approval"],
    [{ type: "verification" }, "verification"],
    [{ type: "done" }, "result"],
    [{ type: "state", state: "PLANNING" }, "status"],
    [{ type: "change", message: "CHANGE_APPLIED" }, "file_change"],
    [{ type: "anything", activity: "thinking" }, "thinking"],
  ];
  for (const [event, expected] of cases)
    assert.equal(agentActivity(event), expected, JSON.stringify(event));
  // Every activity has a label, and nothing maps to a raw camelCase token.
  assert.deepEqual(
    Object.values(ACTIVITY_LABELS).every((label) => label.trim().length > 0),
    true,
  );
  assert.equal(agentActivity({ type: "text" }), "response");
});

test("terminal states are recognised for both events and lifecycle", () => {
  assert.equal(isTerminalEvent({ type: "done" }), true);
  assert.equal(isTerminalEvent({ type: "state", state: "CANCELLED" }), true);
  assert.equal(isTerminalEvent({ type: "state", state: "PLANNING" }), false);
  assert.equal(
    lifecycleFromEvent({
      type: "lifecycle",
      lifecycle: "waiting_for_approval",
    }),
    "waiting_for_approval",
  );
  assert.equal(lifecycleFromEvent({ type: "text" }), null);
});
