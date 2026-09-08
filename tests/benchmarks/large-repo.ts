import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { DatabaseStore } from "../../packages/database/repositories";
import { RepositoryIndexService } from "../../packages/indexing/service";

async function runRepoBenchmark() {
  console.log("=== G1CODE LARGE REPOSITORY BENCHMARK ===");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "g1code-bench-repo-"));

  try {
    const FILE_COUNT = 1000;
    const DIRS = 50;

    console.log(`[1/4] Generating synthetic repository: ${FILE_COUNT} files across ${DIRS} directories...`);
    const genStart = Date.now();
    for (let d = 0; d < DIRS; d++) {
      const dirPath = path.join(tempDir, `pkg_${d}`, "src");
      await fs.mkdir(dirPath, { recursive: true });
    }

    const fileCreationPromises: Promise<void>[] = [];
    for (let f = 0; f < FILE_COUNT; f++) {
      const dirIndex = f % DIRS;
      const filePath = path.join(tempDir, `pkg_${dirIndex}`, "src", `module_${f}.ts`);
      const content = `
export interface Module${f}Config {
  id: string;
  timeout: number;
}
export class ServiceWorker${f} {
  constructor(private config: Module${f}Config) {}
  executeAction(): boolean {
    return true;
  }
}
export function helper${f}(): string {
  return "result_${f}";
}
`;
      fileCreationPromises.push(fs.writeFile(filePath, content, "utf8"));
    }
    await Promise.all(fileCreationPromises);
    const genDuration = Date.now() - genStart;
    console.log(`      Repository generated in ${genDuration}ms`);

    console.log(`[2/4] Indexing repository with RepositoryIndexService...`);
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version VALUES (2);
      CREATE TABLE files (workspace_id TEXT NOT NULL, path TEXT NOT NULL, language TEXT NOT NULL, size INTEGER NOT NULL, modified_time TEXT NOT NULL, hash TEXT NOT NULL, indexed_at TEXT NOT NULL, PRIMARY KEY (workspace_id, path));
      CREATE TABLE symbols (workspace_id TEXT NOT NULL, path TEXT NOT NULL, symbol TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL, column_number INTEGER NOT NULL, parent TEXT, PRIMARY KEY (workspace_id, path, symbol, kind, line));
      CREATE TABLE repository_indexes (workspace_id TEXT PRIMARY KEY, indexed_at TEXT NOT NULL);
    `);
    const store = new DatabaseStore(db);
    const indexService = new RepositoryIndexService(store);

    const memBefore = process.memoryUsage().heapUsed / 1024 / 1024;
    const indexStart = Date.now();
    const indexedEntries = await indexService.index(tempDir);
    const indexDuration = Date.now() - indexStart;
    const memAfter = process.memoryUsage().heapUsed / 1024 / 1024;

    const filesPerSec = ((indexedEntries.length / indexDuration) * 1000).toFixed(1);
    console.log(`      Indexed ${indexedEntries.length} files in ${indexDuration}ms (${filesPerSec} files/sec)`);
    console.log(`      Heap Delta: ${(memAfter - memBefore).toFixed(2)} MB`);

    console.log(`[3/4] Benchmarking symbol search throughput...`);
    const searchQueries = ["ServiceWorker", "helper", "Module10", "executeAction", "config"];
    const searchStart = Date.now();
    let totalMatches = 0;
    const SEARCH_ITERATIONS = 50;

    for (let i = 0; i < SEARCH_ITERATIONS; i++) {
      const q = searchQueries[i % searchQueries.length];
      const results = store.searchSymbols(tempDir, q);
      totalMatches += results.length;
    }
    const searchDuration = Date.now() - searchStart;
    const avgLatency = (searchDuration / SEARCH_ITERATIONS).toFixed(2);
    console.log(`      Executed ${SEARCH_ITERATIONS} symbol searches in ${searchDuration}ms (avg ${avgLatency}ms/query)`);
    console.log(`      Found ${totalMatches} total symbol matches`);

    console.log(`[4/4] Validating threshold criteria...`);
    if (indexedEntries.length < FILE_COUNT) {
      throw new Error(`Expected at least ${FILE_COUNT} indexed files, got ${indexedEntries.length}`);
    }
    if (Number(avgLatency) > 50) {
      throw new Error(`Average search latency too high: ${avgLatency}ms (limit: 50ms)`);
    }

    console.log("=== BENCHMARK PASSED SUCCESSFULLY ===");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

runRepoBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
