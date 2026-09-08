import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { detectProject } from "../packages/testing/detector";
import { discoverTests } from "../packages/testing/discovery";
import { targetedCommand } from "../packages/testing/selector";

test("detects npm projects and ranks related tests", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "g1code-testing-"));
  await mkdir(path.join(root, "src"));
  await mkdir(path.join(root, "tests"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "node --test" } }),
  );
  await writeFile(path.join(root, "src", "calculator.js"), "");
  await writeFile(path.join(root, "tests", "calculator.test.js"), "");
  const project = await detectProject(root);
  assert.equal(project?.type, "npm");
  const candidates = await discoverTests(
    root,
    ["src/calculator.js"],
    project ?? undefined,
  );
  assert.equal(candidates[0]?.path, "tests/calculator.test.js");
  assert.equal(
    targetedCommand(project!, candidates),
    "npm run test -- tests/calculator.test.js",
  );
});
