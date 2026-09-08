import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnCommand } from "../packages/tools/command";
import { spawnExecutable } from "../packages/tools/command";
import { classifyCommand } from "../packages/tools/command-policy";
test("streaming command can be cancelled and returns bounded result", async () => {
  const controller = new AbortController();
  const execution = spawnCommand(
    process.platform === "win32" ? "ping 127.0.0.1 -n 10" : "sleep 10",
    process.cwd(),
    controller.signal,
  );
  controller.abort();
  const result = await execution.wait();
  assert.notEqual(result.exitCode, 0);
});

test("structured commands execute without shell interpolation and enforce timeout", async () => {
  const execution = spawnExecutable({ executable: process.execPath, args: ["-e", "process.stdout.write('ok')"], cwd: process.cwd(), timeoutMs: 1000 });
  const result = await execution.wait();
  assert.equal(result.stdout, "ok");
  const timeout = spawnExecutable({ executable: process.execPath, args: ["-e", "setTimeout(() => {}, 10000)"], cwd: process.cwd(), timeoutMs: 20 });
  const timed = await timeout.wait();
  assert.notEqual(timed.exitCode, 0);
});

test("command risk classification is conservative", () => {
  assert.ok(classifyCommand("git status").includes("READ_ONLY"));
  assert.ok(classifyCommand("npm install").includes("DEPENDENCY_CHANGE"));
  assert.ok(classifyCommand("rm -rf build").includes("DESTRUCTIVE"));
  assert.ok(classifyCommand("unknown-tool --flag").includes("UNKNOWN"));
});
