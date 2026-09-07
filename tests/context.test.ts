import assert from "node:assert/strict";
import { test } from "node:test";
import { ContextBudgetManager } from "../packages/context/budget";
test("context budget preserves highest priority content first", () => {
  const result = new ContextBudgetManager(10).select([
    { kind: "history", content: "1234567890", priority: 1 },
    { kind: "prompt", content: "important", priority: 10 },
  ]);
  assert.equal(result[0].kind, "prompt");
  assert.equal(result.map((part) => part.content).join("").length, 10);
});
