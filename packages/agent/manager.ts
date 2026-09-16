import { AgentRuntime } from "./runtime";

type SessionHandle = { runtime: AgentRuntime; controller: AbortController };
export class AgentRuntimeManager {
  private sessions = new Map<string, SessionHandle>();
  startSession(
    sessionId: string,
    runtime: AgentRuntime,
    run: (signal: AbortSignal) => Promise<void>,
  ) {
    const controller = new AbortController();
    this.sessions.set(sessionId, { runtime, controller });
    void run(controller.signal)
      .catch((error) => {
        // A runtime should normally convert failures into AgentEvents. Keep the
        // manager from producing an unhandled rejection if an integration
        // boundary throws unexpectedly, and always release the session handle.
        console.error(`[AgentRuntimeManager] Session ${sessionId} failed:`, error);
      })
      .finally(() => this.sessions.delete(sessionId));
    return sessionId;
  }
  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }
  cancelSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.controller.abort();
    session.runtime.stop();
    return true;
  }
  stopAll() {
    for (const id of this.sessions.keys()) this.cancelSession(id);
  }
}
