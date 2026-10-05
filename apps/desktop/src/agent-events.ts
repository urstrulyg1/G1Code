/**
 * Agent event model and reducer.
 *
 * This module holds the *logic* of the conversation timeline — deduplication,
 * streaming coalescing, activity classification and terminal-state detection —
 * so it can be unit tested without React or a DOM. The component layer only
 * renders what these functions return.
 */

export type AgentActivity =
  | "thinking"
  | "response"
  | "tool"
  | "command"
  | "approval"
  | "file_change"
  | "verification"
  | "result"
  | "status";

export type Event = {
  id?: string;
  /** IDs folded into this visual event when streaming chunks are merged. */
  eventIds?: string[];
  sessionId?: string;
  at?: string;
  type: string;
  state?: string;
  message?: string;
  detail?: string;
  toolName?: string;
  toolCallId?: string;
  changeId?: string;
  input?: unknown;
  result?: unknown;
  command?: string;
  action?: string;
  stream?: "stdout" | "stderr";
  chunk?: string;
  exitCode?: number;
  duration?: number;
  requestId?: string;
  seq?: number;
  /** Phase 4 activity taxonomy emitted by the runtime. */
  activity?: AgentActivity;
  /** Lifecycle transition emitted by the runtime/session. */
  lifecycle?: string;
  /** Verification progress (id, step, status). */
  verificationId?: string;
  /** Context assembly manifest attached to a `context` event. */
  manifest?: {
    included?: Array<{ path?: string; reason?: string }>;
    excluded?: Array<{ path?: string; reason?: string }>;
    usedChars?: number;
  };
};

export const ACTIVITY_LABELS: Record<AgentActivity, string> = {
  thinking: "Thinking",
  response: "Response",
  tool: "Tool",
  command: "Command",
  approval: "Approval",
  file_change: "File change",
  verification: "Verification",
  result: "Result",
  status: "Status",
};

/**
 * Classify an event for the timeline. The runtime's `activity` field is
 * authoritative; older events (and the persisted backlog) fall back to a
 * deterministic mapping of type/state so the UI never shows an unlabelled row.
 */
export function agentActivity(event: Event): AgentActivity {
  if (event.activity) return event.activity;
  switch (event.type) {
    case "reasoning":
    case "thinking":
      return "thinking";
    case "text":
      return "response";
    case "tool":
      return "tool";
    case "command":
      return "command";
    case "approval":
      return "approval";
    case "verification":
      return "verification";
    case "context":
    case "state":
    case "lifecycle":
      return "status";
    case "done":
      return "result";
    case "error":
      return "result";
    default:
      if (
        event.type === "change" ||
        (event.message ?? "").startsWith("CHANGE_") ||
        event.changeId
      )
        return "file_change";
      return "status";
  }
}

export function isTerminalEvent(event: Event): boolean {
  return (
    event.type === "done" ||
    ["COMPLETED", "FAILED", "STOPPED", "CANCELLED", "INTERRUPTED"].includes(
      event.state ?? "",
    )
  );
}

/** Lifecycle state reported by the runtime, when this event carries one. */
export function lifecycleFromEvent(event: Event): string | null {
  if (event.lifecycle) return event.lifecycle;
  if (event.type === "lifecycle" && event.state) return event.state;
  return null;
}

/**
 * Merge a live/backfilled event into the conversation timeline.
 *
 * Streaming chunks are folded, duplicate deliveries (SSE + history + polling)
 * are dropped by id/seq, and approval resolutions update their original card
 * instead of appending a second one.
 */
export function mergeAgentEvent(old: Event[], event: Event): Event[] {
  if (
    event.requestId &&
    typeof event.seq === "number" &&
    old.some(
      (existing) =>
        existing.requestId === event.requestId &&
        typeof existing.seq === "number" &&
        (existing.seq as number) >= (event.seq as number),
    )
  )
    return old;

  const incomingIds = [
    ...(event.eventIds || []),
    ...(event.id ? [event.id] : []),
  ];
  // SSE, history replay, and the polling backfill can all deliver the same
  // durable event. Treat the event id as the source of truth instead of using
  // array length (text chunks are intentionally folded into fewer rows).
  if (
    incomingIds.length > 0 &&
    old.some((existing) =>
      incomingIds.some(
        (id) => id === existing.id || Boolean(existing.eventIds?.includes(id)),
      ),
    )
  ) {
    return old;
  }

  const normalized: Event = {
    ...event,
    eventIds: incomingIds.length > 0 ? incomingIds : undefined,
  };

  if (event.type === "text") {
    if (!event.message) return old;
    const last = old[old.length - 1];
    if (last && last.type === "text") {
      return [
        ...old.slice(0, -1),
        {
          ...last,
          message: (last.message || "") + event.message,
          eventIds: [
            ...(last.eventIds || (last.id ? [last.id] : [])),
            ...incomingIds,
          ],
          id: undefined,
          seq: event.seq,
          requestId: event.requestId,
        },
      ];
    }
    return [...old, normalized];
  }

  if (
    event.type === "command" &&
    event.action === "chunk" &&
    event.toolCallId
  ) {
    const idx = old.findIndex(
      (e) =>
        (e.type === "command" || e.type === "tool") &&
        e.toolCallId === event.toolCallId,
    );
    if (idx !== -1) {
      const copy = [...old];
      copy[idx] = {
        ...copy[idx],
        chunk: (copy[idx].chunk || "") + (event.chunk || event.message || ""),
        eventIds: [
          ...(copy[idx].eventIds || (copy[idx].id ? [copy[idx].id] : [])),
          ...incomingIds,
        ],
        id: undefined,
        seq: event.seq,
        requestId: event.requestId,
      };
      return copy;
    }
  }

  if (event.type === "approval" && event.result) {
    const idx = old.findIndex((e) => {
      if (e.type !== "approval") return false;
      const inputId =
        e.input && typeof e.input === "object"
          ? (e.input as { changeId?: string }).changeId
          : undefined;
      return (
        (event.changeId && (inputId || e.changeId) === event.changeId) ||
        (event.toolCallId && e.toolCallId === event.toolCallId)
      );
    });
    if (idx !== -1) {
      const copy = [...old];
      copy[idx] = {
        ...copy[idx],
        result: event.result,
        action: event.action || "resolved",
        message: event.message,
        eventIds: [
          ...(copy[idx].eventIds || (copy[idx].id ? [copy[idx].id] : [])),
          ...incomingIds,
        ],
        id: undefined,
      };
      return copy;
    }
  }

  return [...old, normalized];
}
