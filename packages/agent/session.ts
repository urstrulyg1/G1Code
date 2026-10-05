import { SessionLifecycle, type SessionLifecycleState } from "./lifecycle";

type Disposable = () => void | Promise<void>;

/**
 * One agent session. Owns exactly one AbortController and every resource that
 * must be released when the session ends:
 *
 *   * abort listeners registered against the session signal
 *   * pending approval wake-ups
 *   * child processes started by tools
 *   * timers used for stream coalescing
 *
 * Everything that a tool or the runtime creates must be registered here, so a
 * cancellation (or a renderer closing) cannot leave orphaned promises or
 * listeners behind.
 */
export class AgentSession {
  readonly lifecycle: SessionLifecycle;
  private controller = new AbortController();
  private readonly disposables = new Set<Disposable>();
  private readonly children = new Set<{
    kill: (signal?: NodeJS.Signals) => void;
  }>();
  private readonly completionResolvers = new Set<() => void>();
  private finished = false;

  constructor(
    readonly id: string,
    private readonly onLifecycleChange?: (
      state: SessionLifecycleState,
      reason?: string,
    ) => void,
  ) {
    this.lifecycle = new SessionLifecycle(id);
    this.lifecycle.subscribe((transition) => {
      this.onLifecycleChange?.(transition.to, transition.reason);
    });
  }

  get state(): SessionLifecycleState {
    return this.lifecycle.state;
  }

  get terminal(): boolean {
    return this.lifecycle.terminal;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Register a cleanup. Returns a function that removes it again. */
  register(disposable: Disposable): () => void {
    if (this.finished) {
      void Promise.resolve()
        .then(disposable)
        .catch(() => undefined);
      return () => undefined;
    }
    this.disposables.add(disposable);
    return () => this.disposables.delete(disposable);
  }

  /** Track a spawned child process so cancellation can terminate the tree. */
  trackChild(child: { kill: (signal?: NodeJS.Signals) => void }): () => void {
    this.children.add(child);
    return () => this.children.delete(child);
  }

  /** Resolves when the session reaches a terminal state. */
  whenFinished(): Promise<void> {
    if (this.finished) return Promise.resolve();
    return new Promise((resolve) => this.completionResolvers.add(resolve));
  }

  /**
   * Idempotent cancellation. The first call aborts the signal, transitions to
   * `cancelling`, and runs every registered cleanup. Later calls are no-ops,
   * which is what repeated stop requests in the UI depend on.
   */
  requestCancel(reason = "cancelled by user"): boolean {
    const moved = this.lifecycle.requestCancel(reason);
    if (!moved) return false;
    // Abort first: tools and provider streams observe the signal immediately.
    if (!this.controller.signal.aborted) this.controller.abort();
    this.killChildren();
    for (const disposable of [...this.disposables]) {
      this.disposables.delete(disposable);
      try {
        void Promise.resolve(disposable()).catch(() => undefined);
      } catch {
        // Cleanup must never throw into the cancellation path.
      }
    }
    return true;
  }

  markCompleted(reason?: string): void {
    if (this.lifecycle.markCompleted(reason)) this.finish();
  }

  markFailed(reason?: string): void {
    if (this.lifecycle.markFailed(reason)) this.finish();
  }

  /** Fulfil a cancellation that was requested earlier or is requested now. */
  markCancelled(reason = "cancelled by user"): void {
    if (!this.lifecycle.cancelRequested) this.requestCancel(reason);
    if (this.lifecycle.markCancelled(reason)) this.finish();
  }

  dispose(): void {
    if (!this.finished) {
      if (!this.lifecycle.cancelRequested) this.requestCancel("disposed");
      this.lifecycle.markCancelled("disposed");
    }
    this.finish();
  }

  private killChildren(): void {
    for (const child of [...this.children]) {
      this.children.delete(child);
      try {
        child.kill("SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.killChildren();
    for (const disposable of [...this.disposables]) {
      this.disposables.delete(disposable);
      try {
        void Promise.resolve(disposable()).catch(() => undefined);
      } catch {
        // ignore
      }
    }
    for (const resolve of [...this.completionResolvers]) {
      this.completionResolvers.delete(resolve);
      try {
        resolve();
      } catch {
        // ignore
      }
    }
  }
}
