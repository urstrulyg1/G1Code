import assert from "node:assert/strict";
import { test } from "node:test";
import {
  requireAction,
  requireBoundedString,
  requireObject,
} from "../packages/security/validation";

test("IPC validators reject malformed and oversized values", () => {
  assert.throws(() => requireBoundedString(null, "id"), /Invalid id/);
  assert.throws(() => requireBoundedString("", "id"), /Invalid id/);
  assert.throws(
    () => requireBoundedString("x".repeat(11), "id", 10),
    /Invalid id/,
  );
  assert.throws(() => requireObject([], "request"), /Invalid request/);
  assert.throws(
    () => requireAction("delete", ["approve", "reject"]),
    /Invalid action/,
  );
  assert.equal(requireAction("approve", ["approve", "reject"]), "approve");
});
