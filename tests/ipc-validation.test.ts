import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IPC_SCHEMAS,
  IpcValidationError,
  MAX_EDITOR_CONTENT_BYTES,
  MAX_IPC_PAYLOAD_BYTES,
  validateIpcPayload,
} from "../apps/desktop/electron/ipc-schemas";

test("every channel rejects an unknown or oversized payload shape", () => {
  // Malformed input: wrong types
  assert.throws(
    () => validateIpcPayload("agent:stop", "not-an-object"),
    IpcValidationError,
  );
  assert.throws(
    () => validateIpcPayload("file:read", { path: 42 }),
    IpcValidationError,
  );
  // Unknown fields are rejected so a compromised renderer cannot smuggle
  // privileged options through a channel it does not own.
  assert.throws(
    () =>
      validateIpcPayload("agent:stop", { sessionId: "s", privileged: true }),
    /unknown field/,
  );
  // Empty strings where identifiers are required
  assert.throws(
    () => validateIpcPayload("agent:stop", { sessionId: "   " }),
    /must not be empty/,
  );
});

test("oversized payloads are rejected before they reach the filesystem", () => {
  assert.throws(
    () =>
      validateIpcPayload("agent:start", {
        workspace: "/tmp/project",
        prompt: "x".repeat(200_001),
        mode: "agent",
      }),
    IpcValidationError,
  );
  assert.throws(
    () =>
      validateIpcPayload("file:write", {
        path: "/tmp/project/a.ts",
        contents: "x".repeat(MAX_EDITOR_CONTENT_BYTES + 1),
      }),
    /exceeds/,
  );
  assert.throws(
    () =>
      validateIpcPayload("workspace:search", {
        query: "ok",
        padding: "y".repeat(MAX_IPC_PAYLOAD_BYTES + 1),
      }),
    IpcValidationError,
  );
});

test("control characters in paths are rejected", () => {
  assert.throws(
    () => validateIpcPayload("file:read", { path: "/tmp/a\u0000b" }),
    /control characters/,
  );
});

test("valid payloads are normalised into the exact expected shape", () => {
  const start = validateIpcPayload<{
    workspace: string;
    prompt: string;
    mode: string;
    sessionId?: string;
  }>("agent:start", {
    workspace: "/tmp/project",
    prompt: "do the thing",
    mode: "agent",
  });
  assert.deepEqual(start, {
    workspace: "/tmp/project",
    prompt: "do the thing",
    mode: "agent",
  });

  const change = validateIpcPayload("agent:change", {
    sessionId: "s1",
    id: "c1",
    action: "approve",
  });
  assert.deepEqual(change, { sessionId: "s1", id: "c1", action: "approve" });
});

test("enumerated actions only accept the documented values", () => {
  assert.throws(
    () =>
      validateIpcPayload("agent:change", {
        sessionId: "s1",
        id: "c1",
        action: "delete-everything",
      }),
    /must be one of/,
  );
  assert.throws(
    () =>
      validateIpcPayload("agent:start", {
        workspace: "/tmp/project",
        prompt: "hi",
        mode: "root",
      }),
    /must be one of/,
  );
});

test("channels that take no payload reject unexpected data", () => {
  assert.equal(validateIpcPayload("settings:get", undefined), undefined);
  assert.throws(
    () => validateIpcPayload("settings:get", { anything: 1 }),
    /does not accept a payload/,
  );
});

test("an unregistered channel fails closed", () => {
  assert.throws(
    () => validateIpcPayload("totally:new:channel", {}),
    /no schema registered/,
  );
});

test("channel catalogue stays in sync with the preload surface", () => {
  // Guards against adding an IPC channel in preload/main without a schema.
  const required = [
    "workspace:set",
    "file:write",
    "terminal:run",
    "agent:start",
    "agent:stop",
    "agent:change",
    "permission:response",
    "repository:search",
    "context:assemble",
    "verification:run",
    "diagnostics:get",
    "git:blame",
  ];
  for (const channel of required) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(IPC_SCHEMAS, channel),
      `${channel} must have a validator`,
    );
  }
});
