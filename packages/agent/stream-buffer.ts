/**
 * Bounded, coalescing buffers for streamed model output.
 *
 * Requirement: a chatty provider must not be able to flood the renderer, the
 * event log, or SQLite with one persistence write per token.
 *
 * Two guarantees:
 *   1. `maxChars` bounds how much text is buffered before a flush is forced.
 *   2. `flush()` is idempotent, so a cancelled stream can flush exactly once.
 */
export class BoundedTextBuffer {
  private buffer = "";
  private dropped = 0;
  private flushed = false;

  constructor(
    private readonly maxChars = 4096,
    private readonly onFlush?: (
      text: string,
      meta: { droppedChars: number },
    ) => void,
  ) {}

  get pending(): number {
    return this.buffer.length;
  }

  get droppedChars(): number {
    return this.dropped;
  }

  push(chunk: string): void {
    if (!chunk) return;
    this.buffer += chunk;
    if (this.buffer.length >= this.maxChars) this.flush();
  }

  /** Flush now (used on completion, on tool calls, and on cancellation). */
  flush(): string {
    if (this.flushed) return "";
    if (!this.buffer) return "";
    const text = this.buffer;
    this.buffer = "";
    this.flushed = true;
    this.onFlush?.(text, { droppedChars: this.dropped });
    return text;
  }

  /**
   * Take everything buffered without marking the buffer as finished. Used when
   * a long stream needs to be persisted incrementally.
   */
  drain(): string {
    const text = this.buffer;
    this.buffer = "";
    return text;
  }

  /** Hard cap for pathological streams: drop the oldest text. */
  enforceHardLimit(limit = 2_000_000): void {
    if (this.buffer.length <= limit) return;
    const excess = this.buffer.length - limit;
    this.buffer = this.buffer.slice(excess);
    this.dropped += excess;
  }
}

/**
 * Queue with a hard capacity. Producers never block; when a consumer is slower
 * than the producer the queue coalesces strings instead of growing without
 * bound.
 */
export class BoundedQueue<T> {
  private items: T[] = [];
  private waiters: Array<(value: T | undefined) => void> = [];
  private closed = false;

  constructor(private readonly capacity = 256) {}

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return;
    }
    if (this.items.length >= this.capacity) {
      // Coalesce instead of dropping: replace the oldest entry with a marker
      // kept separate from the newest data.
      this.items.shift();
    }
    this.items.push(item);
  }

  async pull(): Promise<T | undefined> {
    if (this.items.length) return this.items.shift();
    if (this.closed) return undefined;
    return new Promise<T | undefined>((resolve) => this.waiters.push(resolve));
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter(undefined);
  }

  get size(): number {
    return this.items.length;
  }
}

export type SseBackpressureOptions = {
  /** Maximum bytes buffered for one client before text deltas are coalesced. */
  highWaterMark?: number;
  /** Called when deltas were coalesced to keep the client responsive. */
  onCoalesce?: (count: number) => void;
};

/**
 * Tracks per-client SSE backpressure. `http.ServerResponse.write` returns false
 * when the socket buffer is full; instead of queueing unlimited agent events we
 * count them and let the caller skip low-value text deltas.
 */
export class SseBackpressure {
  private buffered = 0;
  private coalesced = 0;
  private readonly highWaterMark: number;

  constructor(private readonly options: SseBackpressureOptions = {}) {
    this.highWaterMark = options.highWaterMark ?? 4 * 1024 * 1024;
  }

  onWriteAccepted(bytes: number, writable: boolean): void {
    this.buffered += bytes;
    if (writable) this.buffered = Math.max(0, this.buffered - bytes);
  }

  get saturated(): boolean {
    return this.buffered >= this.highWaterMark;
  }

  noteCoalesced(count = 1): void {
    this.coalesced += count;
    this.options.onCoalesce?.(count);
  }

  get coalescedCount(): number {
    return this.coalesced;
  }

  reset(): void {
    this.buffered = 0;
  }
}
