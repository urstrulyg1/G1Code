import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { safeRealPath } from "./workspace";

export const contentHash = (content: string) =>
  createHash("sha256").update(content).digest("hex");
export function unifiedDiff(
  filePath: string,
  original: string,
  proposed: string,
) {
  const before = original.split(/\r?\n/);
  const after = proposed.split(/\r?\n/);
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start += 1;
  let endBefore = before.length - 1;
  let endAfter = after.length - 1;
  while (
    endBefore >= start &&
    endAfter >= start &&
    before[endBefore] === after[endAfter]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const removed = before.slice(start, endBefore + 1).map((line) => `-${line}`);
  const added = after.slice(start, endAfter + 1).map((line) => `+${line}`);
  return [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${start + 1},${Math.max(0, removed.length)} +${start + 1},${Math.max(0, added.length)} @@`,
    ...removed,
    ...added,
  ].join("\n");
}
export async function applyApprovedChange(
  workspace: string,
  requestedPath: string,
  originalHash: string,
  original: string,
  proposed: string,
) {
  const filePath = await safeRealPath(workspace, requestedPath);
  const current = await fs.readFile(filePath, "utf8").catch(() => null);
  if (current === null && original !== "")
    return { status: "CONFLICT" as const, reason: "File no longer exists" };
  if (
    current !== null &&
    (contentHash(current) !== originalHash || current !== original)
  )
    return {
      status: "CONFLICT" as const,
      reason: "File changed since it was inspected",
    };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, proposed, "utf8");
  return {
    status: "APPLIED" as const,
    path: filePath,
    originalHash,
    proposedHash: contentHash(proposed),
    patch: unifiedDiff(path.relative(workspace, filePath), original, proposed),
  };
}
export async function revertAppliedChange(
  workspace: string,
  requestedPath: string,
  proposedHash: string,
  original: string,
  applied: string,
) {
  const filePath = await safeRealPath(workspace, requestedPath);
  const current = await fs.readFile(filePath, "utf8").catch(() => null);
  if (
    current === null ||
    contentHash(current) !== proposedHash ||
    current !== applied
  )
    return {
      status: "CONFLICT" as const,
      reason: "File contains additional changes",
    };
  await fs.writeFile(filePath, original, "utf8");
  return { status: "REVERTED" as const, path: filePath };
}
