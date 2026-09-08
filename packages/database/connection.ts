import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function openDatabase(customDir?: string) {
  let directory = customDir;
  if (!directory) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require("electron");
      if (
        electron &&
        typeof electron === "object" &&
        electron.app &&
        typeof electron.app.getPath === "function"
      ) {
        directory = electron.app.getPath("userData");
      }
    } catch {
      // not in electron runtime
    }
  }
  if (!directory) {
    directory = path.join(os.homedir(), ".g1code");
  }
  fs.mkdirSync(directory, { recursive: true });
  const database = new Database(path.join(directory, "g1code.sqlite"));
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL); INSERT INTO schema_version SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, mode TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(session_id) REFERENCES sessions(id));
    CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT, tool_name TEXT NOT NULL, arguments TEXT NOT NULL, result TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT);
    CREATE TABLE IF NOT EXISTS agent_events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, timestamp TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS file_changes (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, path TEXT NOT NULL, original_hash TEXT NOT NULL, proposed_hash TEXT NOT NULL, original_content TEXT NOT NULL DEFAULT '', proposed_content TEXT NOT NULL DEFAULT '', applied_content TEXT, patch TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS files (workspace_id TEXT NOT NULL, path TEXT NOT NULL, language TEXT NOT NULL, size INTEGER NOT NULL, modified_time TEXT NOT NULL, hash TEXT NOT NULL, indexed_at TEXT NOT NULL, PRIMARY KEY (workspace_id, path));
      CREATE TABLE IF NOT EXISTS symbols (workspace_id TEXT NOT NULL, path TEXT NOT NULL, symbol TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL, column_number INTEGER NOT NULL, parent TEXT, PRIMARY KEY (workspace_id, path, symbol, kind, line));
      CREATE TABLE IF NOT EXISTS repository_indexes (workspace_id TEXT PRIMARY KEY, indexed_at TEXT NOT NULL);`);
  database.exec(
    "CREATE TABLE IF NOT EXISTS git_baselines (session_id TEXT PRIMARY KEY, branch TEXT NOT NULL, head TEXT NOT NULL, status TEXT NOT NULL, diff TEXT NOT NULL, modified_files TEXT NOT NULL, captured_at TEXT NOT NULL)",
  );
  database.exec(`CREATE TABLE IF NOT EXISTS test_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, command TEXT NOT NULL, cwd TEXT NOT NULL, targeted INTEGER NOT NULL, exit_code INTEGER, passed INTEGER, stdout TEXT NOT NULL, stderr TEXT NOT NULL, duration INTEGER NOT NULL, created_at TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS repair_attempts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, attempt_number INTEGER NOT NULL, test_run_id TEXT, diagnosis TEXT NOT NULL, evidence TEXT NOT NULL, change_ids TEXT NOT NULL, approval_status TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS task_memory (session_id TEXT PRIMARY KEY, summary TEXT NOT NULL, updated_at TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS task_summaries (session_id TEXT PRIMARY KEY, task TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  database.exec(
    "CREATE TABLE IF NOT EXISTS execution_checkpoints (session_id TEXT PRIMARY KEY, state TEXT NOT NULL, iteration INTEGER NOT NULL, tool_calls INTEGER NOT NULL, checkpoint TEXT NOT NULL, updated_at TEXT NOT NULL)",
  );
  database.exec(`CREATE TABLE IF NOT EXISTS change_batches (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, workspace_id TEXT NOT NULL, status TEXT NOT NULL, failure_reason TEXT, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT);
     CREATE TABLE IF NOT EXISTS change_batch_items (batch_id TEXT NOT NULL, change_id TEXT NOT NULL, path TEXT NOT NULL, original_hash TEXT NOT NULL, proposed_hash TEXT NOT NULL, original_content TEXT NOT NULL, proposed_content TEXT NOT NULL, backup_content TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY (batch_id, change_id));`);
  const version = (
    database.prepare("SELECT version FROM schema_version LIMIT 1").get() as {
      version: number;
    }
  ).version;
  if (version < 2) {
    database.transaction(() => {
      for (const statement of [
        "ALTER TABLE file_changes ADD COLUMN original_content TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE file_changes ADD COLUMN proposed_content TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE file_changes ADD COLUMN applied_content TEXT",
      ]) {
        try {
          database.exec(statement);
        } catch {
          /* already migrated */
        }
      }
      const columns = database
        .prepare("PRAGMA table_info(files)")
        .all() as Array<{ name: string }>;
      if (
        columns.length > 0 &&
        !columns.some((column) => column.name === "workspace_id")
      ) {
        database.exec(
          "ALTER TABLE files RENAME TO files_legacy; CREATE TABLE files (workspace_id TEXT NOT NULL, path TEXT NOT NULL, language TEXT NOT NULL, size INTEGER NOT NULL, modified_time TEXT NOT NULL, hash TEXT NOT NULL, indexed_at TEXT NOT NULL, PRIMARY KEY (workspace_id, path));",
        );
        // Legacy rows predate workspace ownership. Preserve them under an explicit
        // migration bucket so they can be rebuilt rather than silently discarded.
        database.exec(
          "CREATE TABLE IF NOT EXISTS legacy_index_files AS SELECT * FROM files_legacy WHERE 0",
        );
        database.exec(
          "INSERT INTO legacy_index_files SELECT * FROM files_legacy",
        );
      }
      database.prepare("UPDATE schema_version SET version = 2").run();
    })();
  }
  return database;
}
