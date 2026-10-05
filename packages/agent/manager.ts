import { AgentSession } from "./session";
import type { AgentRuntime } from "./runtime";
import type { SessionLifecycleState } from "./lifecycle";

export type ActiveSessionSnapshot = {
  sessionId: string;
  state: SessionLifecycleState;
  startedAt: string;
  turns: number;
  toolCalls: number;
  cancelRequested: boolean;
};

type SessionHandle = {
  session: AgentSession;
  runtime: AgentRuntime;
  startedAt: string;
};

export type CancelOutcome = "requested" | "already-cancelling" | "not-found";

/**
 * Owns every live agent session.
 *
 * Rules enforced here (each one is covered by tests):
 *   * one session id maps to exactly one runtime — starting an id twice throws
 *     instead of silently sharing state;
 *   * cancellation is idempotent and returns a typed outcome;
 *   * a session handle is released in `finally`, so an unexpected throw cannot
 *     leak a runtime;
 *   * `stopAll` never throws and always leaves the map empty.
 */
export class AgentRuntimeManager {
  private sessions = new Map<string, SessionHandle>();
  private readonly listeners = new Set<() => void>();

  startSession(
    sessionId: string,
    runtime: AgentRuntime,
    run: (signal: AbortSignal, session: AgentSession) => Promise<void>,
  ): AgentSession {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is already running`);
    }
    const session = new AgentSession(sessionId, () => notify(this.listeners));
    const handle: SessionHandle = {
      session,
      runtime,
      startedAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, handle);
    notify(this.listeners);

    void run(session.signal, session)
      .then(() => this.finish(session, "completed", "runtime returned"))
      .catch((error) => {
        // A runtime is expected to translate failures into AgentEvents. If an
        // integration boundary throws anyway, keep the manager (and the
        // process) from producing an unhandled rejection.
        console.error(
          `[AgentRuntimeManager] Session ${sessionId} failed:`,
          error,
        );
        this.finish(session, "failed", "runtime threw unexpectedly");
      });
    return session;
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  /** The AgentSession (signal + lifecycle) for a live run. */
  getAgentSession(sessionId: string) {
    return this.sessions.get(sessionId)?.session;
  }

  hasSession(sessionId: string) {
    return this.sessions.has(sessionId);
  }

  /** Number of live sessions — used by diagnostics. */
  size() {
    return this.sessions.size;
  }

  activeSessions(): ActiveSessionSnapshot[] {
    return [...this.sessions.values()].map(
      ({ session, runtime, startedAt }) => ({
        sessionId: session.id,
        state: session.state,
        startedAt,
        turns: runtime?.iterationCount?.() ?? 0,
        toolCalls: runtime?.toolCallCount?.() ?? 0,
        cancelRequested: session.lifecycle.cancelRequested,
      }),
    );
  }

  removeSession(sessionId: string) {
    const handle = this.sessions.get(sessionId);
    if (!handle) return false;
    handle.session.dispose();
    this.sessions.delete(sessionId);
    notify(this.listeners);
    return true;
  }

  cancelSession(sessionId: string): CancelOutcome {
    const handle = this.sessions.get(sessionId);
    if (!handle) return "not-found";
    if (handle.session.lifecycle.cancelRequested) return "already-cancelling";
    handle.session.requestCancel("stopped by user");
    try {
      handle.runtime?.stop?.();
    } catch (error) {
      console.error(
        `[AgentRuntimeManager] runtime.stop() threw for ${sessionId}:`,
        error,
      );
    }
    return "requested";
  }

  /** Cancel every session (renderer closed, app quitting, server shutdown). */
  stopAll(reason = "application shutdown") {
    for (const [id, handle] of this.sessions) {
      try {
        if (!handle.session.lifecycle.cancelRequested)
          handle.session.requestCancel(reason);
        handle.runtime?.stop?.();
      } catch (error) {
        console.error(`[AgentRuntimeManager] Failed to cancel ${id}:`, error);
      }
    }
  }

  /**
   * Release the handle *before* marking the terminal state, so code waiting on
   * `session.whenFinished()` never observes a session that is still registered.
   */
  private finish(
    session: AgentSession,
    outcome: "completed" | "failed",
    reason: string,
  ) {
    this.sessions.delete(session.id);
    try {
      if (!session.terminal) {
        if (outcome === "completed") session.markCompleted(reason);
        else session.markFailed(reason);
      }
    } finally {
      notify(this.listeners);
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function notify(listeners: Set<() => void>) {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // Diagnostics listeners must never break session management.
    }
  }
}
