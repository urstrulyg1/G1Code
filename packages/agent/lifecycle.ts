/**
 * Phase 4 session lifecycle.
 *
 * The previous implementation tracked cancellation with two booleans inside the
 * runtime (`stopped`, `cancelled`) plus an in-memory map in the manager. That
 * made two things impossible:
 *
 *   1. Telling the difference between "we asked to cancel and are still
 *      unwinding" and "cancellation finished".
 *   2. Guaranteeing that a second stop request is a no-op instead of a second
 *      unwind pass over listeners and child processes.
 *
 * This module defines one explicit state machine used by the runtime, the
 * manager, the server, and the tests.
 */

export type SessionLifecycleState =
  | "created"
  | "running"
  | "waiting_for_approval"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export type SessionTerminalState = Extract<
  SessionLifecycleState,
  "completed" | "failed" | "cancelled"
>;

export const TERMINAL_STATES: readonly SessionTerminalState[] = [
  "completed",
  "failed",
  "cancelled",
];

export function isTerminal(state: SessionLifecycleState): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

/**
 * Allowed transitions. `cancelling` is reachable from every non-terminal state
 * and only ever exits to `cancelled`, which is what makes cancellation
 * idempotent and observable.
 */
const TRANSITIONS: Record<
  SessionLifecycleState,
  readonly SessionLifecycleState[]
> = {
  created: ["running", "cancelling", "failed", "completed"],
  running: ["waiting_for_approval", "cancelling", "completed", "failed"],
  waiting_for_approval: ["running", "cancelling", "completed", "failed"],
  cancelling: ["cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export type LifecycleTransitionListener = (transition: {
  sessionId: string;
  from: SessionLifecycleState;
  to: SessionLifecycleState;
  at: string;
  reason?: string;
}) => void;

export class SessionLifecycle {
  private current: SessionLifecycleState = "created";
  private readonly listeners = new Set<LifecycleTransitionListener>();
  private history: Array<{
    from: SessionLifecycleState;
    to: SessionLifecycleState;
    at: string;
    reason?: string;
  }> = [];

  constructor(readonly sessionId: string) {}

  get state(): SessionLifecycleState {
    return this.current;
  }

  get terminal(): boolean {
    return isTerminal(this.current);
  }

  get cancelling(): boolean {
    return this.current === "cancelling";
  }

  /** True once cancellation was requested, even if unwind is still running. */
  get cancelRequested(): boolean {
    return this.current === "cancelling" || this.current === "cancelled";
  }

  transitions() {
    return [...this.history];
  }

  subscribe(listener: LifecycleTransitionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Transition to a new state.
   *
   * Terminal states absorb late transitions (returning false) because events can
   * legitimately arrive after cancellation finished — a provider stream that
   * flushes its last chunk, or a tool that resolves late. Anything else that is
   * illegal throws, which keeps programming errors loud.
   */
  transition(to: SessionLifecycleState, reason?: string): boolean {
    if (to === this.current) return false;
    if (isTerminal(this.current)) return false;
    if (!TRANSITIONS[this.current].includes(to)) {
      throw new Error(
        `Illegal session transition for ${this.sessionId}: ${this.current} -> ${to}`,
      );
    }
    const from = this.current;
    this.current = to;
    const at = new Date().toISOString();
    this.history.push({ from, to, at, reason });
    for (const listener of [...this.listeners]) {
      try {
        listener({ sessionId: this.sessionId, from, to, at, reason });
      } catch {
        // A listener must never be able to break the session state machine.
      }
    }
    return true;
  }

  /**
   * Idempotent cancellation. Returns true when this call moved the session into
   * `cancelling`; false when it was already cancelling or already terminal,
   * which is what repeated stop requests rely on.
   */
  requestCancel(reason = "cancelled by user"): boolean {
    if (this.current === "cancelling" || this.terminal) return false;
    return this.transition("cancelling", reason);
  }

  /** Finish a cancellation that was previously requested. */
  markCancelled(reason?: string): boolean {
    if (this.current === "cancelled") return false;
    if (this.current !== "cancelling")
      return this.requestCancel(reason) && this.markCancelled(reason);
    return this.transition("cancelled", reason);
  }

  markCompleted(reason?: string): boolean {
    if (this.terminal) return false;
    if (this.current === "cancelling") return this.markCancelled(reason);
    return this.transition("completed", reason);
  }

  markFailed(reason?: string): boolean {
    if (this.terminal) return false;
    if (this.current === "cancelling") return this.markCancelled(reason);
    return this.transition("failed", reason);
  }
}
