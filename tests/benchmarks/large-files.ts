import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { workspaceTools } from "../../packages/tools/workspace";
import { unifiedDiff } from "../../packages/tools/changes";

async function runLargeFilesBenchmark() {
  console.log("=== G1CODE LARGE FILES BENCHMARK ===");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "g1code-bench-files-"));

  try {
    const tools = workspaceTools();
    const readFileTool = tools.find((t) => t.name === "read_file")!;

    // 1. Generate large test files (1MB, 5MB, 15MB)
    const sizesMB = [1, 5, 15];
    for (const size of sizesMB) {
      console.log(`[1/3] Generating ${size}MB test file...`);
      const filePath = path.join(tempDir, `large_${size}mb.txt`);
      const line = "0123456789abcdef".repeat(6) + "\n"; // ~100 bytes per line
      const lineCount = (size * 1024 * 1024) / line.length;

      let content = "";
      for (let i = 0; i < lineCount; i++) {
        content += `Line ${i.toString().padStart(8, "0")}: ${line}`;
      }
      await fs.writeFile(filePath, content, "utf8");

      const stats = await fs.stat(filePath);
      console.log(`      Created file: ${filePath} (${(stats.size / 1024 / 1024).toFixed(2)} MB, ${lineCount} lines)`);

      // 2. Benchmark chunked line-based pagination
      console.log(`[2/3] Benchmarking line-based pagination on ${size}MB file...`);
      const startPaging = Date.now();
      const readResult = await readFileTool.execute(
        {
          path: `large_${size}mb.txt`,
          startLine: 1000,
          endLine: 1500,
        },
        {
          workspace: tempDir,
          approve: async () => true,
          emit: () => {},
        },
      );
      const pagingDuration = Date.now() - startPaging;
      console.log(`      Paging slice (lines 1000-1500) completed in ${pagingDuration}ms`);
      if (readResult.isError) {
        throw new Error(`Paging failed: ${readResult.content}`);
      }

      // 3. Benchmark unified diff performance on large sections
      console.log(`[3/3] Benchmarking diff generation on section of ${size}MB file...`);
      const originalSlice = content.slice(0, 500_000);
      const modifiedSlice = originalSlice.replace(/Line 00000010/g, "Line MODIFIED_10");
      const diffStart = Date.now();
      const diff = unifiedDiff(`large_${size}mb.txt`, originalSlice, modifiedSlice);
      const diffDuration = Date.now() - diffStart;
      console.log(`      Generated diff (${diff.length} bytes) in ${diffDuration}ms`);
      if (diffDuration > 2000) {
        throw new Error(`Diff duration too high: ${diffDuration}ms`);
      }
    }

    console.log("=== LARGE FILES BENCHMARK PASSED SUCCESSFULLY ===");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

runLargeFilesBenchmark().catch((err) => {
  console.error("Large files benchmark failed:", err);
  process.exit(1);
});
