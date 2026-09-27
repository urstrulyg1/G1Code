import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { scanRepository } from "../packages/indexing/repository";

test("repository scan honors gitignore and excludes sensitive files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "g1code-index-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "ignored"), { recursive: true });
  await writeFile(
    path.join(root, ".gitignore"),
    "ignored/\n*.generated.ts\n",
  );
  await writeFile(
    path.join(root, "src", "main.ts"),
    "export function main() {}\n",
  );
  await writeFile(
    path.join(root, "ignored", "secret.ts"),
    "export const secret = true;\n",
  );
  await writeFile(
    path.join(root, "model.generated.ts"),
    "export const generated = true;\n",
  );
  await writeFile(path.join(root, ".env"), "TOKEN=do-not-index\n");

  const result = await scanRepository(root);
  const paths = result.map((entry) => entry.path.replaceAll("\\", "/"));

  assert(paths.includes("src/main.ts"));
  assert(!paths.includes("ignored/secret.ts"));
  assert(!paths.includes("model.generated.ts"));
  assert(!paths.includes(".env"));
});

test("repository scan does not follow symlink targets or index binary blobs", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "g1code-index-"));
  const outside = await mkdtemp(path.join(tmpdir(), "g1code-index-outside-"));
  await writeFile(path.join(outside, "outside.ts"), "export const outside = true;\n");
  await writeFile(path.join(root, "binary.dat"), Buffer.from([0, 1, 2, 3, 4]));

  try {
    await symlink(
      path.join(outside, "outside.ts"),
      path.join(root, "linked.ts"),
      process.platform === "win32" ? "file" : "file",
    );
  } catch (error) {
    if (process.platform === "win32") {
      t.skip(`symlink creation is unavailable on this runner: ${String(error)}`);
    } else {
      throw error;
    }
  }

  const result = await scanRepository(root);
  const paths = result.map((entry) => entry.path.replaceAll("\\", "/"));
  assert(!paths.includes("linked.ts"));
  assert(!paths.includes("binary.dat"));
});
