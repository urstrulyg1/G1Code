import assert from "node:assert/strict";
import { test } from "node:test";
import { safePath } from "../packages/tools/workspace";

test("workspace paths stay inside the selected root", () => {
  assert.equal(
    safePath("C:/workspace", "src/index.ts"),
    "C:\\workspace\\src\\index.ts",
  );
  assert.throws(
    () => safePath("C:/workspace", "../../etc/passwd"),
    /outside the selected workspace/,
  );
  assert.throws(
    () => safePath("C:/workspace", "C:/other/file.txt"),
    /outside the selected workspace/,
  );
});
