import Database from "better-sqlite3";
import { promises as fs } from "node:fs";
import path from "node:path";
import { app } from "electron";

export function openDatabase() {
  const directory = app.getPath("userData");
  void fs.mkdir(directory, { recursive: true });
  const database = new Database(path.join(directory, "g1code.sqlite"));
  database.pragma("journal_mode = WAL");
  database.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL); INSERT INTO schema_version SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, mode TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(session_id) REFERENCES sessions(id));
    CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT, tool_name TEXT NOT NULL, arguments TEXT NOT NULL, result TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT);
    CREATE TABLE IF NOT EXISTS agent_events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, timestamp TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS file_changes (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, path TEXT NOT NULL, original_hash TEXT NOT NULL, proposed_hash TEXT NOT NULL, patch TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  return database;
}
