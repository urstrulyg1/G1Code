import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decidePermission,
  isKnownTool,
  permissionCatalog,
  type ToolPermissionSettings,
} from "../packages/security/permission-policy";

const enabled: ToolPermissionSettings = {
  readFiles: true,
  searchRepository: true,
  editFiles: true,
  createFiles: true,
  deleteFiles: true,
  renameFiles: true,
  runTests: true,
  runBuilds: true,
  runCommands: true,
  networkTools: false,
};

const decide = (
  toolName: string,
  overrides: Partial<ToolPermissionSettings> = {},
  executionMode: "review" | "auto" | "plan" | "readonly" = "review",
  extra: { targetExists?: boolean; command?: string } = {},
) =>
  decidePermission({
    toolName,
    input: extra.command ? { command: extra.command } : {},
    executionMode,
    permissions: { ...enabled, ...overrides },
    ...extra,
  });

test("review mode lets the agent propose changes instead of silently denying them", () => {
  // Regression: the previous inline logic returned false for every
  // non-dangerous tool in review mode, which is the default mode, so the agent
  // could not edit, test, or run anything.
  const write = decide("write_file", {}, "review", { targetExists: true });
  assert.equal(write.decision, "allow");
  assert.equal(write.reason, "review-mode-proposes-change");

  const tests = decide("run_tests", {}, "review");
  assert.equal(tests.decision, "ask", "execution still needs an explicit approval");

  const read = decide("read_file", {}, "review");
  assert.equal(read.decision, "allow");
});

test("auto mode allows permitted edits and commands but always asks for dangerous ones", () => {
  assert.equal(decide("apply_patch", {}, "auto").decision, "allow");
  assert.equal(decide("run_command", {}, "auto", { command: "npm test" }).decision, "allow");
  assert.equal(
    decide("run_command", {}, "auto", { command: "rm -rf build" }).decision,
    "ask",
  );
  assert.equal(decide("delete_file", {}, "auto").decision, "ask");
});

test("plan and readonly modes never allow a mutating or executing tool", () => {
  for (const mode of ["plan", "readonly"] as const) {
    assert.equal(decide("write_file", {}, mode, { targetExists: true }).decision, "deny");
    assert.equal(decide("run_command", {}, mode, { command: "npm test" }).decision, "deny");
    assert.equal(decide("run_tests", {}, mode).decision, "deny");
    assert.equal(decide("read_file", {}, mode).decision, "allow");
    assert.equal(decide("search_repository", {}, mode).decision, "allow");
  }
});

test("settings switches are a hard stop, not a suggestion", () => {
  assert.equal(
    decide("read_file", { readFiles: false }).decision,
    "deny",
  );
  assert.equal(
    decide("write_file", { editFiles: false }, "auto", { targetExists: true })
      .decision,
    "deny",
  );
  assert.equal(
    decide("write_file", { createFiles: false }, "auto", { targetExists: false })
      .decision,
    "deny",
  );
  assert.equal(
    decide("run_tests", { runTests: false }, "auto").decision,
    "deny",
  );
  assert.equal(
    decide("run_command", { runBuilds: false }, "auto", {
      command: "npm run build",
    }).decision,
    "deny",
  );
  assert.equal(
    decide("run_command", { runTests: false }, "auto", { command: "npm test" })
      .decision,
    "deny",
  );
});

test("write_file distinguishes edit from create permissions", () => {
  assert.equal(
    decide("write_file", { createFiles: false }, "auto", { targetExists: false })
      .decision,
    "deny",
  );
  assert.equal(
    decide("write_file", { createFiles: false }, "auto", { targetExists: true })
      .decision,
    "allow",
  );
  const unknown = decidePermission({
    toolName: "write_file",
    executionMode: "auto",
    permissions: { ...enabled, editFiles: false },
  });
  assert.equal(unknown.decision, "allow", "createFiles alone is sufficient");
});

test("unknown tools fail closed", () => {
  const verdict = decide("execute_anything");
  assert.equal(verdict.decision, "deny");
  assert.equal(verdict.reason, "unknown-tool");
  assert.equal(isKnownTool("execute_anything"), false);
});

test("destructive and privileged commands always ask, even in auto mode", () => {
  for (const command of [
    "rm -rf node_modules",
    "sudo rm -rf /",
    "git reset --hard HEAD~5",
    "npm install left-pad",
  ]) {
    assert.equal(
      decide("run_command", {}, "auto", { command }).decision,
      "ask",
      `${command} must require approval`,
    );
  }
});

test("permission catalog covers every registered tool category", () => {
  const catalog = permissionCatalog();
  assert.ok(catalog.read_only.includes("read_file"));
  assert.ok(catalog.mutating.includes("write_file"));
  assert.ok(catalog.execution.includes("run_command"));
  assert.ok(catalog.execution.includes("run_tests"));
  assert.ok(catalog.read_only.includes("search_repository"));
});
