import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  AgentEventRecord,
  ChangeBatch,
  FileChange,
  Session,
  SessionStatus,
} from "./types";
import { ChatStorage } from "./chat-storage";

const now = () => new Date().toISOString();

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
export class DatabaseStore {
  private readonly unsubscribeEviction?: () => void;

  constructor(private readonly db: Database.Database) {
    // Keep lightweight/in-memory test databases and older persisted stores
    // compatible with the current file-operation journal schema.
    try {
      const columns = this.db
        .prepare("PRAGMA table_info(file_changes)")
        .all() as Array<{ name: string }>;
      if (
        columns.length > 0 &&
        !columns.some((column) => column.name === "operation")
      )
        this.db.exec(
          "ALTER TABLE file_changes ADD COLUMN operation TEXT NOT NULL DEFAULT 'write'",
        );
      if (
        columns.length > 0 &&
        !columns.some((column) => column.name === "target_path")
      )
        this.db.exec("ALTER TABLE file_changes ADD COLUMN target_path TEXT");
    } catch {
      // The production connection owns full schema migration; keep construction
      // tolerant for isolated stores that do not include file_changes at all.
    }
    this.unsubscribeEviction = ChatStorage.onSessionEvicted((sessionId) => {
      try {
        if (this.db?.open) {
          this.deleteSession(sessionId);
        }
      } catch {
        // ignore
      }
    });
  }

  dispose() {
    this.unsubscribeEviction?.();
  }

  deleteSession(id: string) {
    if (!this.db || !this.db.open) return;
    try {
      this.db.transaction(() => {
        try {
          this.db.prepare("DELETE FROM messages WHERE session_id = ?").run(id);
        } catch {}
        try {
          this.db
            .prepare("DELETE FROM tool_calls WHERE session_id = ?")
            .run(id);
        } catch {}
        try {
          this.db
            .prepare("DELETE FROM agent_events WHERE session_id = ?")
            .run(id);
        } catch {}
        try {
          this.db
            .prepare("DELETE FROM task_summaries WHERE session_id = ?")
            .run(id);
        } catch {}
        try {
          this.db
            .prepare("DELETE FROM task_memory WHERE session_id = ?")
            .run(id);
        } catch {}
        try {
          this.db
            .prepare("DELETE FROM execution_checkpoints WHERE session_id = ?")
            .run(id);
        } catch {}
        try {
          this.db.prepare("DELETE FROM test_runs WHERE session_id = ?").run(id);
        } catch {}
        try {
          this.db
            .prepare("DELETE FROM repair_attempts WHERE session_id = ?")
            .run(id);
        } catch {}
        try {
          this.db
            .prepare("DELETE FROM git_baselines WHERE session_id = ?")
            .run(id);
        } catch {}
        try {
          this.db
            .prepare("DELETE FROM file_changes WHERE session_id = ?")
            .run(id);
        } catch {}
        try {
          this.db
            .prepare(
              "DELETE FROM change_batch_items WHERE batch_id IN (SELECT id FROM change_batches WHERE session_id = ?)",
            )
            .run(id);
          this.db
            .prepare("DELETE FROM change_batches WHERE session_id = ?")
            .run(id);
        } catch {}
        try {
          this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
        } catch {}
      })();
    } catch (err) {
      console.error(`[DatabaseStore] Failed to delete session ${id}:`, err);
    }
  }

  createSession(input: Omit<Session, "createdAt" | "updatedAt">) {
    const timestamp = now();
    const session = { ...input, createdAt: timestamp, updatedAt: timestamp };
    this.db
      .prepare(
        "INSERT INTO sessions (id,workspace_id,title,mode,model,provider,status,created_at,updated_at) VALUES (@id,@workspaceId,@title,@mode,@model,@provider,@status,@createdAt,@updatedAt)",
      )
      .run(session);
    try {
      ChatStorage.persistChat(session, []);
    } catch {
      // ignore
    }
    return session;
  }
  updateSessionStatus(id: string, status: SessionStatus) {
    this.db
      .prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, now(), id);
    try {
      const session = this.getSession(id);
      if (session) {
        ChatStorage.persistChat(session, this.sessionMessages(id));
      }
    } catch {
      // ignore
    }
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
        "SELECT id, role, content, created_at as createdAt FROM messages WHERE session_id = ? ORDER BY created_at, rowid",
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
  sessionTestRuns(sessionId: string): Array<{
    id: string;
    command: string;
    cwd: string;
    targeted: number;
    exitCode?: number;
    passed?: number;
    stdout?: string;
    stderr?: string;
    duration?: number;
    createdAt: string;
  }> {
    return this.db
      .prepare(
        "SELECT id, command, cwd, targeted, exit_code as exitCode, passed, stdout, stderr, duration, created_at as createdAt FROM test_runs WHERE session_id = ? ORDER BY created_at",
      )
      .all(sessionId) as Array<{
      id: string;
      command: string;
      cwd: string;
      targeted: number;
      exitCode?: number;
      passed?: number;
      stdout?: string;
      stderr?: string;
      duration?: number;
      createdAt: string;
    }>;
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
    try {
      const session = this.getSession(sessionId);
      if (session) {
        ChatStorage.persistChat(
          session,
          this.sessionMessages(sessionId),
          summary,
        );
      }
    } catch {
      // ignore
    }
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

  // -------------------------------------------------------------------------
  // Phase 4 repository intelligence
  // -------------------------------------------------------------------------

  replaceImports(
    workspaceId: string,
    filePath: string,
    imports: Array<{
      module: string;
      kind: string;
      line: number;
      resolvedPath?: string | null;
      names?: string[];
    }>,
  ) {
    const transaction = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM file_imports WHERE workspace_id = ? AND path = ?")
        .run(workspaceId, filePath);
      const insert = this.db.prepare(
        "INSERT OR REPLACE INTO file_imports (workspace_id, path, module, kind, line, resolved_path, names) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      for (const item of imports)
        insert.run(
          workspaceId,
          filePath,
          item.module,
          item.kind,
          item.line,
          item.resolvedPath ?? null,
          item.names ? JSON.stringify(item.names) : null,
        );
    });
    transaction();
  }

  importsForFile(workspaceId: string, filePath: string) {
    return this.db
      .prepare(
        "SELECT module, kind, line, resolved_path as resolvedPath FROM file_imports WHERE workspace_id = ? AND path = ? ORDER BY line",
      )
      .all(workspaceId, filePath) as Array<{
      module: string;
      kind: string;
      line: number;
      resolvedPath: string | null;
    }>;
  }

  /** Files that import the given path (reverse dependency lookup). */
  importerPaths(workspaceId: string, filePath: string, limit = 50) {
    return this.db
      .prepare(
        "SELECT DISTINCT path FROM file_imports WHERE workspace_id = ? AND resolved_path = ? ORDER BY path LIMIT ?",
      )
      .all(workspaceId, filePath, limit) as Array<{ path: string }>;
  }

  searchImports(workspaceId: string, query: string, limit = 100) {
    return this.db
      .prepare(
        "SELECT DISTINCT path, module FROM file_imports WHERE workspace_id = ? AND lower(module) LIKE lower(?) LIMIT ?",
      )
      .all(workspaceId, `%${query}%`, limit) as Array<{
      path: string;
      module: string;
    }>;
  }

  symbolsForFile(workspaceId: string, filePath: string) {
    return this.db
      .prepare(
        "SELECT symbol, kind, line, column_number as column, parent FROM symbols WHERE workspace_id = ? AND path = ? ORDER BY line",
      )
      .all(workspaceId, filePath) as Array<{
      symbol: string;
      kind: string;
      line: number;
      column: number;
      parent: string | null;
    }>;
  }

  replaceFileGitMeta(
    workspaceId: string,
    entries: Array<{
      path: string;
      status: string;
      lastCommit?: string | null;
      lastCommitAt?: string | null;
      lastCommitSubject?: string | null;
    }>,
  ) {
    const transaction = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM file_git_meta WHERE workspace_id = ?")
        .run(workspaceId);
      const insert = this.db.prepare(
        "INSERT OR REPLACE INTO file_git_meta (workspace_id, path, status, last_commit, last_commit_at, last_commit_subject) VALUES (?, ?, ?, ?, ?, ?)",
      );
      for (const entry of entries)
        insert.run(
          workspaceId,
          entry.path,
          entry.status,
          entry.lastCommit ?? null,
          entry.lastCommitAt ?? null,
          entry.lastCommitSubject ?? null,
        );
    });
    transaction();
  }

  fileGitMeta(workspaceId: string, filePath: string) {
    return this.db
      .prepare(
        "SELECT status, last_commit as lastCommit, last_commit_at as lastCommitAt, last_commit_subject as lastCommitSubject FROM file_git_meta WHERE workspace_id = ? AND path = ?",
      )
      .get(workspaceId, filePath) as
      | {
          status: string;
          lastCommit: string | null;
          lastCommitAt: string | null;
          lastCommitSubject: string | null;
        }
      | undefined;
  }

  gitModifiedFiles(workspaceId: string) {
    return this.db
      .prepare(
        "SELECT path, status FROM file_git_meta WHERE workspace_id = ? AND status NOT IN ('', 'clean') ORDER BY path",
      )
      .all(workspaceId) as Array<{ path: string; status: string }>;
  }

  recentIndexedFiles(workspaceId: string, limit = 25) {
    return this.db
      .prepare(
        "SELECT path, language, size, modified_time as modifiedTime FROM files WHERE workspace_id = ? ORDER BY modified_time DESC LIMIT ?",
      )
      .all(workspaceId, limit) as Array<{
      path: string;
      language: string;
      size: number;
      modifiedTime: string;
    }>;
  }

  searchIndexedFiles(workspaceId: string, query: string, limit = 100) {
    return this.db
      .prepare(
        "SELECT path, language, size, modified_time as modifiedTime FROM files WHERE workspace_id = ? AND lower(path) LIKE lower(?) ORDER BY length(path), path LIMIT ?",
      )
      .all(workspaceId, `%${query}%`, limit) as Array<{
      path: string;
      language: string;
      size: number;
      modifiedTime: string;
    }>;
  }

  indexFreshness(workspaceId: string) {
    return this.db
      .prepare(
        "SELECT indexed_at as indexedAt FROM repository_indexes WHERE workspace_id = ?",
      )
      .get(workspaceId) as { indexedAt: string } | undefined;
  }

  markIndexed(workspaceId: string) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO repository_indexes (workspace_id, indexed_at) VALUES (?, ?)",
      )
      .run(workspaceId, now());
  }

  addVerificationRun(run: {
    id: string;
    sessionId?: string | null;
    workspaceId: string;
    status: string;
    level: string;
    changedFiles: string[];
    steps: unknown;
    summary: string;
  }) {
    this.db
      .prepare(
        "INSERT INTO verification_runs (id, session_id, workspace_id, status, level, changed_files, steps, summary, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        run.id,
        run.sessionId ?? null,
        run.workspaceId,
        run.status,
        run.level,
        JSON.stringify(run.changedFiles),
        JSON.stringify(run.steps),
        run.summary,
        now(),
        run.status === "RUNNING" ? null : now(),
      );
    return run.id;
  }

  updateVerificationRun(
    id: string,
    status: string,
    steps: unknown,
    summary: string,
  ) {
    this.db
      .prepare(
        "UPDATE verification_runs SET status = ?, steps = ?, summary = ?, completed_at = ? WHERE id = ?",
      )
      .run(status, JSON.stringify(steps), summary, now(), id);
  }

  verificationRun(id: string) {
    const row = this.db
      .prepare(
        "SELECT id, session_id as sessionId, workspace_id as workspaceId, status, level, changed_files as changedFiles, steps, summary, created_at as createdAt, completed_at as completedAt FROM verification_runs WHERE id = ?",
      )
      .get(id) as
      | {
          id: string;
          sessionId: string | null;
          workspaceId: string;
          status: string;
          level: string;
          changedFiles: string;
          steps: string;
          summary: string;
          createdAt: string;
          completedAt: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      ...row,
      changedFiles: JSON.parse(row.changedFiles) as string[],
      steps: JSON.parse(row.steps) as unknown,
    };
  }

  verificationRuns(workspaceId: string, sessionId?: string, limit = 20) {
    const rows = (
      sessionId
        ? this.db
            .prepare(
              "SELECT id, session_id as sessionId, status, level, changed_files as changedFiles, steps, summary, created_at as createdAt, completed_at as completedAt FROM verification_runs WHERE workspace_id = ? AND session_id = ? ORDER BY created_at DESC LIMIT ?",
            )
            .all(workspaceId, sessionId, limit)
        : this.db
            .prepare(
              "SELECT id, session_id as sessionId, status, level, changed_files as changedFiles, steps, summary, created_at as createdAt, completed_at as completedAt FROM verification_runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
            )
            .all(workspaceId, limit)
    ) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...row,
      changedFiles: JSON.parse(String(row.changedFiles)) as string[],
      steps: JSON.parse(String(row.steps)) as unknown,
    }));
  }

  sessionChangeStats(sessionId: string) {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) as total, SUM(CASE WHEN status = 'APPLIED' THEN 1 ELSE 0 END) as applied, SUM(CASE WHEN status = 'CONFLICT' THEN 1 ELSE 0 END) as conflicts FROM file_changes WHERE session_id = ?",
      )
      .get(sessionId) as
      | {
          total: number | null;
          applied: number | null;
          conflicts: number | null;
        }
      | undefined;
    return {
      total: row?.total ?? 0,
      applied: row?.applied ?? 0,
      conflicts: row?.conflicts ?? 0,
    };
  }

  renameSession(id: string, title: string) {
    this.db
      .prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
      .run(title.slice(0, 200), now(), id);
  }

  setSessionArchived(id: string, archived: boolean) {
    this.db
      .prepare("UPDATE sessions SET archived = ?, updated_at = ? WHERE id = ?")
      .run(archived ? 1 : 0, now(), id);
  }

  /**
   * Recent sessions with the metadata the sidebar needs (change and
   * verification counts) in one query instead of N+1 lookups from the renderer.
   */
  sessionHistory(workspaceId: string, limit = 50, includeArchived = false) {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.title, s.mode, s.status, s.model, s.created_at as createdAt, s.updated_at as updatedAt,
                s.archived as archived,
                (SELECT COUNT(*) FROM file_changes c WHERE c.session_id = s.id) as changeCount,
                (SELECT COUNT(*) FROM file_changes c WHERE c.session_id = s.id AND c.status = 'APPLIED') as appliedCount,
                (SELECT COUNT(*) FROM file_changes c WHERE c.session_id = s.id AND c.status = 'CONFLICT') as conflictCount,
                (SELECT status FROM verification_runs v WHERE v.session_id = s.id ORDER BY v.created_at DESC LIMIT 1) as verificationStatus,
                (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) as messageCount
         FROM sessions s
         WHERE s.workspace_id = ? ${includeArchived ? "" : "AND COALESCE(s.archived, 0) = 0"}
         ORDER BY s.updated_at DESC LIMIT ?`,
      )
      .all(workspaceId, limit) as Array<Record<string, unknown>>;
    return rows.map((row): Record<string, unknown> => ({
      ...row,
      archived: Boolean(row.archived),
    }));
  }

  /**
   * Deterministically ordered events for one session, used both for the live SSE
   * stream and for restoration. `afterSeq` lets a client resume without gaps.
   */
  orderedSessionEvents(sessionId: string, afterSeq = 0, limit = 5000) {
    const rows = this.db
      .prepare(
        "SELECT id, event_type as eventType, payload, timestamp FROM agent_events WHERE session_id = ? ORDER BY timestamp, rowid LIMIT ?",
      )
      .all(sessionId, limit) as Array<{
      id: string;
      eventType: string;
      payload: string;
      timestamp: string;
    }>;
    return rows
      .map((row) => ({
        id: row.id,
        eventType: row.eventType,
        timestamp: row.timestamp,
        payload: safeParse(row.payload),
      }))
      .filter((entry) => {
        const seq = (entry.payload as { seq?: number } | undefined)?.seq;
        return typeof seq !== "number" || seq > afterSeq;
      });
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
    const timestamp = now();
    this.db
      .prepare(
        "INSERT INTO messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)",
      )
      .run(id, sessionId, role, content, timestamp);
    try {
      const session = this.getSession(sessionId);
      if (session) {
        ChatStorage.persistChat(session, this.sessionMessages(sessionId));
      }
    } catch {
      // ignore
    }
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
        "SELECT id,session_id as sessionId,event_type as eventType,payload,timestamp FROM agent_events WHERE session_id = ? ORDER BY timestamp, rowid",
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
        "INSERT INTO file_changes (id,session_id,path,operation,target_path,original_hash,proposed_hash,original_content,proposed_content,applied_content,patch,status,created_at,updated_at) VALUES (@id,@sessionId,@path,@operation,@targetPath,@originalHash,@proposedHash,@originalContent,@proposedContent,@appliedContent,@patch,@status,@createdAt,@updatedAt)",
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
        "SELECT id, session_id as sessionId, path, operation, target_path as targetPath, original_hash as originalHash, proposed_hash as proposedHash, original_content as originalContent, proposed_content as proposedContent, applied_content as appliedContent, patch, status, created_at as createdAt, updated_at as updatedAt FROM file_changes WHERE id = ?",
      )
      .get(id) as FileChange | undefined;
  }
  updateSessionModel(id: string, model: string) {
    this.db
      .prepare("UPDATE sessions SET model = ?, updated_at = ? WHERE id = ?")
      .run(model, now(), id);
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
      ? "SELECT id, session_id as sessionId, path, operation, target_path as targetPath, original_hash as originalHash, proposed_hash as proposedHash, original_content as originalContent, proposed_content as proposedContent, applied_content as appliedContent, patch, status, created_at as createdAt, updated_at as updatedAt FROM file_changes WHERE session_id = ? AND status IN ('PENDING','APPROVED','APPLYING') ORDER BY created_at"
      : "SELECT id, session_id as sessionId, path, operation, target_path as targetPath, original_hash as originalHash, proposed_hash as proposedHash, original_content as originalContent, proposed_content as proposedContent, applied_content as appliedContent, patch, status, created_at as createdAt, updated_at as updatedAt FROM file_changes WHERE status IN ('PENDING','APPROVED','APPLYING') ORDER BY created_at";
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
