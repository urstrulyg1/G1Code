import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  AgentEventRecord,
  ChangeBatch,
  FileChange,
  Session,
  SessionStatus,
} from "./types";

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
  markRunningSessionsInterrupted() {
    this.db
      .prepare(
        "UPDATE sessions SET status = 'INTERRUPTED', updated_at = ? WHERE status IN ('RUNNING','WAITING_FOR_APPROVAL')",
      )
      .run(now());
    this.db
      .prepare(
        "UPDATE file_changes SET status = 'CONFLICT', updated_at = ? WHERE status = 'APPLYING'",
      )
      .run(now());
  }
  recentSessions(workspaceId: string, limit = 20) {
    return this.db
      .prepare(
        "SELECT id, workspace_id as workspaceId, title, mode, model, provider, status, created_at as createdAt, updated_at as updatedAt FROM sessions WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?",
      )
      .all(workspaceId, limit) as Session[];
  }
  sessionMessages(sessionId: string) {
    return this.db
      .prepare(
        "SELECT id, role, content, created_at as createdAt FROM messages WHERE session_id = ? ORDER BY created_at",
      )
      .all(sessionId) as Array<{
      id: string;
      role: string;
      content: string;
      createdAt: string;
    }>;
  }
  replaceFileIndex(
    workspaceId: string,
    entries: Array<{
      path: string;
      language: string;
      size: number;
      modifiedTime: string;
      hash: string;
    }>,
  ) {
    const insert = this.db.prepare(
      "INSERT OR REPLACE INTO files (workspace_id, path, language, size, modified_time, hash, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const transaction = this.db.transaction(() => {
      for (const entry of entries)
        insert.run(
          workspaceId,
          entry.path,
          entry.language,
          entry.size,
          entry.modifiedTime,
          entry.hash,
          now(),
        );
    });
    transaction();
  }
  indexedFiles(workspaceId: string) {
    return this.db
      .prepare(
        "SELECT path, language, size, modified_time as modifiedTime, hash, indexed_at as indexedAt FROM files WHERE workspace_id = ? ORDER BY path",
      )
      .all(workspaceId) as Array<{
      path: string;
      language: string;
      size: number;
      modifiedTime: string;
      hash: string;
      indexedAt: string;
    }>;
  }
  removeMissingFiles(workspaceId: string, paths: string[]) {
    if (!paths.length) return;
    const remove = this.db.prepare(
      "DELETE FROM files WHERE workspace_id = ? AND path = ?",
    );
    const transaction = this.db.transaction(() => {
      for (const filePath of paths) remove.run(workspaceId, filePath);
    });
    transaction();
  }
  replaceSymbols(
    workspaceId: string,
    filePath: string,
    symbols: Array<{
      symbol: string;
      kind: string;
      line: number;
      column: number;
      parent?: string;
    }>,
  ) {
    const transaction = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM symbols WHERE workspace_id = ? AND path = ?")
        .run(workspaceId, filePath);
      const insert = this.db.prepare(
        "INSERT INTO symbols (workspace_id, path, symbol, kind, line, column_number, parent) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      for (const item of symbols)
        insert.run(
          workspaceId,
          filePath,
          item.symbol,
          item.kind,
          item.line,
          item.column,
          item.parent ?? null,
        );
    });
    transaction();
  }
  saveGitBaseline(
    sessionId: string,
    baseline: {
      branch: string;
      head: string;
      status: string;
      diff: string;
      modifiedFiles: string[];
      capturedAt: string;
    },
  ) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO git_baselines (session_id, branch, head, status, diff, modified_files, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        sessionId,
        baseline.branch,
        baseline.head,
        baseline.status,
        baseline.diff,
        JSON.stringify(baseline.modifiedFiles),
        baseline.capturedAt,
      );
  }
  gitBaseline(sessionId: string) {
    const row = this.db
      .prepare(
        "SELECT session_id as sessionId, branch, head, status, diff, modified_files as modifiedFiles, captured_at as capturedAt FROM git_baselines WHERE session_id = ?",
      )
      .get(sessionId) as
      | {
          sessionId: string;
          branch: string;
          head: string;
          status: string;
          diff: string;
          modifiedFiles: string;
          capturedAt: string;
        }
      | undefined;
    return row
      ? { ...row, modifiedFiles: JSON.parse(row.modifiedFiles) as string[] }
      : undefined;
  }
  addTestRun(
    sessionId: string,
    run: {
      command: string;
      cwd: string;
      targeted: boolean;
      exitCode?: number;
      passed?: boolean;
      stdout?: string;
      stderr?: string;
      duration?: number;
    },
  ) {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO test_runs (id,session_id,command,cwd,targeted,exit_code,passed,stdout,stderr,duration,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        sessionId,
        run.command,
        run.cwd,
        run.targeted ? 1 : 0,
        run.exitCode ?? null,
        run.passed === undefined ? null : run.passed ? 1 : 0,
        run.stdout ?? "",
        run.stderr ?? "",
        run.duration ?? 0,
        now(),
      );
    return id;
  }
  sessionTestRuns(sessionId: string) {
    return this.db
      .prepare(
        "SELECT id, command, cwd, targeted, exit_code as exitCode, passed, stdout, stderr, duration, created_at as createdAt FROM test_runs WHERE session_id = ? ORDER BY created_at",
      )
      .all(sessionId);
  }
  addRepairAttempt(
    sessionId: string,
    input: {
      attemptNumber: number;
      testRunId?: string;
      diagnosis: string;
      evidence: unknown;
      changeIds: string[];
      approvalStatus: string;
      result: string;
    },
  ) {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO repair_attempts (id,session_id,attempt_number,test_run_id,diagnosis,evidence,change_ids,approval_status,result,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        sessionId,
        input.attemptNumber,
        input.testRunId ?? null,
        input.diagnosis,
        JSON.stringify(input.evidence),
        JSON.stringify(input.changeIds),
        input.approvalStatus,
        input.result,
        now(),
      );
    return id;
  }
  repairAttempts(sessionId: string) {
    return this.db
      .prepare(
        "SELECT id, attempt_number as attemptNumber, test_run_id as testRunId, diagnosis, evidence, change_ids as changeIds, approval_status as approvalStatus, result, created_at as createdAt FROM repair_attempts WHERE session_id = ? ORDER BY attempt_number",
      )
      .all(sessionId);
  }
  saveTaskMemory(sessionId: string, summary: string) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO task_memory (session_id,summary,updated_at) VALUES (?,?,?)",
      )
      .run(sessionId, summary, now());
  }
  taskMemory(sessionId: string) {
    return this.db
      .prepare(
        "SELECT session_id as sessionId, summary, updated_at as updatedAt FROM task_memory WHERE session_id = ?",
      )
      .get(sessionId);
  }
  saveTaskSummary(
    sessionId: string,
    task: string,
    status: string,
    summary: string,
  ) {
    const timestamp = now();
    this.db
      .prepare(
        "INSERT OR REPLACE INTO task_summaries (session_id,task,status,summary,created_at,updated_at) VALUES (?,?,?,?,COALESCE((SELECT created_at FROM task_summaries WHERE session_id = ?),?),?)",
      )
      .run(sessionId, task, status, summary, sessionId, timestamp, timestamp);
  }
  taskSummary(sessionId: string) {
    return this.db
      .prepare(
        "SELECT session_id as sessionId, task, status, summary, created_at as createdAt, updated_at as updatedAt FROM task_summaries WHERE session_id = ?",
      )
      .get(sessionId);
  }
  changesForSession(sessionId: string) {
    return this.db
      .prepare(
        "SELECT path, status FROM file_changes WHERE session_id = ? ORDER BY created_at",
      )
      .all(sessionId) as Array<{ path: string; status: string }>;
  }
  sessionSummaryData(sessionId: string) {
    return {
      session: this.getSession(sessionId),
      changes: this.changesForSession(sessionId),
      tests: this.sessionTestRuns(sessionId),
      repairs: this.repairAttempts(sessionId),
      baseline: this.gitBaseline(sessionId),
    };
  }
  sessionRepairHistory(sessionId: string) {
    return this.repairAttempts(sessionId);
  }
  saveCheckpoint(
    sessionId: string,
    state: string,
    iteration: number,
    toolCalls: number,
    checkpoint: unknown,
  ) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO execution_checkpoints (session_id,state,iteration,tool_calls,checkpoint,updated_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        sessionId,
        state,
        iteration,
        toolCalls,
        JSON.stringify(checkpoint),
        now(),
      );
  }
  checkpoint(sessionId: string) {
    const row = this.db
      .prepare(
        "SELECT session_id as sessionId, state, iteration, tool_calls as toolCalls, checkpoint, updated_at as updatedAt FROM execution_checkpoints WHERE session_id = ?",
      )
      .get(sessionId) as
      | {
          sessionId: string;
          state: string;
          iteration: number;
          toolCalls: number;
          checkpoint: string;
          updatedAt: string;
        }
      | undefined;
    return row
      ? { ...row, checkpoint: JSON.parse(row.checkpoint) as unknown }
      : undefined;
  }
  searchSymbols(workspaceId: string, query: string) {
    return this.db
      .prepare(
        "SELECT symbol, kind, path, line, column_number as column, parent FROM symbols WHERE workspace_id = ? AND lower(symbol) LIKE lower(?) ORDER BY CASE WHEN lower(symbol) = lower(?) THEN 0 ELSE 1 END, symbol LIMIT 100",
      )
      .all(workspaceId, `%${query}%`, query);
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
  toolCallForSession(sessionId: string, toolCallId: string) {
    return this.db
      .prepare(
        "SELECT id, session_id as sessionId, tool_name as toolName, arguments, result, status, started_at as startedAt, completed_at as completedAt FROM tool_calls WHERE session_id = ? AND id = ?",
      )
      .get(sessionId, toolCallId);
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
        "INSERT INTO file_changes (id,session_id,path,original_hash,proposed_hash,original_content,proposed_content,applied_content,patch,status,created_at,updated_at) VALUES (@id,@sessionId,@path,@originalHash,@proposedHash,@originalContent,@proposedContent,@appliedContent,@patch,@status,@createdAt,@updatedAt)",
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
  transitionChangeStatus(
    id: string,
    from: FileChange["status"],
    to: FileChange["status"],
  ) {
    return this.db
      .prepare(
        "UPDATE file_changes SET status = ?, updated_at = ? WHERE id = ? AND status = ?",
      )
      .run(to, now(), id, from).changes;
  }
  createChangeBatch(
    batch: Omit<ChangeBatch, "createdAt" | "startedAt" | "completedAt">,
    changes: FileChange[],
  ) {
    const timestamp = now();
    const insertBatch = this.db.prepare(
      "INSERT INTO change_batches (id,session_id,workspace_id,status,failure_reason,created_at,started_at,completed_at) VALUES (?,?,?,?,?,?,?,?)",
    );
    const insertItem = this.db.prepare(
      "INSERT INTO change_batch_items (batch_id,change_id,path,original_hash,proposed_hash,original_content,proposed_content,backup_content,status) VALUES (?,?,?,?,?,?,?,?,?)",
    );
    const transaction = this.db.transaction(() => {
      insertBatch.run(
        batch.id,
        batch.sessionId,
        batch.workspaceId,
        batch.status,
        batch.failureReason ?? null,
        timestamp,
        null,
        null,
      );
      for (const change of changes)
        insertItem.run(
          batch.id,
          change.id,
          change.path,
          change.originalHash,
          change.proposedHash,
          change.originalContent,
          change.proposedContent,
          change.originalContent,
          "PENDING",
        );
    });
    transaction();
    return {
      ...batch,
      createdAt: timestamp,
      startedAt: null,
      completedAt: null,
    };
  }
  changeBatch(id: string) {
    return this.db
      .prepare(
        "SELECT id, session_id as sessionId, workspace_id as workspaceId, status, failure_reason as failureReason, created_at as createdAt, started_at as startedAt, completed_at as completedAt FROM change_batches WHERE id = ?",
      )
      .get(id) as ChangeBatch | undefined;
  }
  changeBatchItems(id: string) {
    return this.db
      .prepare(
        "SELECT batch_id as batchId, change_id as changeId, path, original_hash as originalHash, proposed_hash as proposedHash, original_content as originalContent, proposed_content as proposedContent, backup_content as backupContent, status FROM change_batch_items WHERE batch_id = ? ORDER BY path",
      )
      .all(id) as Array<{
      batchId: string;
      changeId: string;
      path: string;
      originalHash: string;
      proposedHash: string;
      originalContent: string;
      proposedContent: string;
      backupContent: string;
      status: string;
    }>;
  }
  updateChangeBatch(
    id: string,
    status: ChangeBatch["status"],
    failureReason?: string,
  ) {
    this.db
      .prepare(
        "UPDATE change_batches SET status = ?, failure_reason = ?, started_at = CASE WHEN ? IN ('PREPARING','APPLYING') AND started_at IS NULL THEN ? ELSE started_at END, completed_at = CASE WHEN ? IN ('APPLIED','ROLLED_BACK','PARTIAL_FAILURE','CONFLICT','FAILED') THEN ? ELSE completed_at END WHERE id = ?",
      )
      .run(status, failureReason ?? null, status, now(), status, now(), id);
  }
  updateChangeBatchItem(batchId: string, changeId: string, status: string) {
    this.db
      .prepare(
        "UPDATE change_batch_items SET status = ? WHERE batch_id = ? AND change_id = ?",
      )
      .run(status, batchId, changeId);
  }
  activeChangeBatches() {
    return this.db
      .prepare(
        "SELECT id, session_id as sessionId, workspace_id as workspaceId, status, failure_reason as failureReason, created_at as createdAt, started_at as startedAt, completed_at as completedAt FROM change_batches WHERE status IN ('PREPARING','APPLYING','ROLLING_BACK')",
      )
      .all() as ChangeBatch[];
  }
  getChange(id: string) {
    return this.db
      .prepare(
        "SELECT id, session_id as sessionId, path, original_hash as originalHash, proposed_hash as proposedHash, original_content as originalContent, proposed_content as proposedContent, applied_content as appliedContent, patch, status, created_at as createdAt, updated_at as updatedAt FROM file_changes WHERE id = ?",
      )
      .get(id) as FileChange | undefined;
  }
  getSession(id: string) {
    return this.db
      .prepare(
        "SELECT id, workspace_id as workspaceId, title, mode, model, provider, status, created_at as createdAt, updated_at as updatedAt FROM sessions WHERE id = ?",
      )
      .get(id) as Session | undefined;
  }
  pendingChanges(sessionId?: string) {
    const query = sessionId
      ? "SELECT id, session_id as sessionId, path, original_hash as originalHash, proposed_hash as proposedHash, original_content as originalContent, proposed_content as proposedContent, applied_content as appliedContent, patch, status, created_at as createdAt, updated_at as updatedAt FROM file_changes WHERE session_id = ? AND status IN ('PENDING','APPROVED','APPLYING') ORDER BY created_at"
      : "SELECT id, session_id as sessionId, path, original_hash as originalHash, proposed_hash as proposedHash, original_content as originalContent, proposed_content as proposedContent, applied_content as appliedContent, patch, status, created_at as createdAt, updated_at as updatedAt FROM file_changes WHERE status IN ('PENDING','APPROVED','APPLYING') ORDER BY created_at";
    return (
      sessionId
        ? this.db.prepare(query).all(sessionId)
        : this.db.prepare(query).all()
    ) as FileChange[];
  }
  updateAppliedContent(id: string, content: string) {
    this.db
      .prepare(
        "UPDATE file_changes SET applied_content = ?, updated_at = ? WHERE id = ?",
      )
      .run(content, now(), id);
  }
  close() {
    this.db.close();
  }
}
