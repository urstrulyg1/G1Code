import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { AgentEventRecord, FileChange, Session, SessionStatus } from "./types";

const now = () => new Date().toISOString();
export class DatabaseStore {
  constructor(private readonly db: Database.Database) {}
  createSession(input: Omit<Session, "createdAt" | "updatedAt">) {
    const timestamp = now();
    this.db
      .prepare(
        "INSERT INTO sessions (id,workspace_id,title,mode,model,provider,status,created_at,updated_at) VALUES (@id,@workspaceId,@title,@mode,@model,@provider,@status,@createdAt,@updatedAt)",
      )
      .run({ ...input, createdAt: timestamp, updatedAt: timestamp });
    return { ...input, createdAt: timestamp, updatedAt: timestamp };
  }
  updateSessionStatus(id: string, status: SessionStatus) {
    this.db
      .prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, now(), id);
  }
  recentSessions(workspaceId: string, limit = 20) {
    return this.db
      .prepare(
        "SELECT id, workspace_id as workspaceId, title, mode, model, provider, status, created_at as createdAt, updated_at as updatedAt FROM sessions WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?",
      )
      .all(workspaceId, limit) as Session[];
  }
  addMessage(sessionId: string, role: string, content: string) {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)",
      )
      .run(id, sessionId, role, content, now());
    return id;
  }
  addToolCall(
    sessionId: string,
    toolName: string,
    args: unknown,
    status = "STARTED",
  ) {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO tool_calls (id,session_id,tool_name,arguments,status,started_at) VALUES (?,?,?,?,?,?)",
      )
      .run(id, sessionId, toolName, JSON.stringify(args), status, now());
    return id;
  }
  finishToolCall(id: string, result: unknown, status: string) {
    this.db
      .prepare(
        "UPDATE tool_calls SET result = ?, status = ?, completed_at = ? WHERE id = ?",
      )
      .run(JSON.stringify(result), status, now(), id);
  }
  addEvent(
    sessionId: string,
    eventType: string,
    payload: unknown,
  ): AgentEventRecord {
    const record = {
      id: randomUUID(),
      sessionId,
      eventType,
      payload,
      timestamp: now(),
    };
    this.db
      .prepare(
        "INSERT INTO agent_events (id,session_id,event_type,payload,timestamp) VALUES (?,?,?,?,?)",
      )
      .run(
        record.id,
        sessionId,
        eventType,
        JSON.stringify(payload),
        record.timestamp,
      );
    return record;
  }
  sessionEvents(sessionId: string) {
    return this.db
      .prepare(
        "SELECT id,session_id as sessionId,event_type as eventType,payload,timestamp FROM agent_events WHERE session_id = ? ORDER BY timestamp",
      )
      .all(sessionId)
      .map((row) => ({
        ...(row as AgentEventRecord),
        payload: JSON.parse((row as { payload: string }).payload),
      }));
  }
  addChange(change: Omit<FileChange, "createdAt" | "updatedAt">) {
    const timestamp = now();
    this.db
      .prepare(
        "INSERT INTO file_changes (id,session_id,path,original_hash,proposed_hash,patch,status,created_at,updated_at) VALUES (@id,@sessionId,@path,@originalHash,@proposedHash,@patch,@status,@createdAt,@updatedAt)",
      )
      .run({ ...change, createdAt: timestamp, updatedAt: timestamp });
    return { ...change, createdAt: timestamp, updatedAt: timestamp };
  }
  updateChangeStatus(id: string, status: FileChange["status"]) {
    this.db
      .prepare(
        "UPDATE file_changes SET status = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, now(), id);
  }
  close() {
    this.db.close();
  }
}
