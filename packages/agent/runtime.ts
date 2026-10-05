import { randomUUID } from "node:crypto";
import { AIProvider, ChatMessage, ToolCall, ToolDefinition } from "../ai/types";
import { globalModelCatalog } from "../ai/models";
import { AgentTool, ToolContext, ToolRegistry } from "../tools/types";
import { redactObject, redactSecrets } from "../security/redaction";
import { AgentSession } from "./session";
import { BoundedTextBuffer } from "./stream-buffer";
import type { SessionLifecycleState } from "./lifecycle";

/**
 * User-facing activity taxonomy. The renderer uses this to render an accurate
 * timeline instead of guessing from raw event types, and it deliberately has no
 * "chain of thought" member: reasoning is reported as `thinking` (a status),
 * never as content.
 */
export type AgentActivity =
  | "thinking"
  | "response"
  | "tool"
  | "command"
  | "approval"
  | "file_change"
  | "verification"
  | "result";

export type AgentState =
  | "IDLE"
  | "CREATED"
  | "RUNNING"
  | "CANCELLING"
  | "UNDERSTANDING"
  | "ANALYZING"
  | "PLANNING"
  | "WAITING_FOR_APPROVAL"
  | "WAITING_FOR_CHANGE_APPROVAL"
  | "EXECUTING"
  | "OBSERVING"
  | "VERIFYING"
  | "REPLANNING"
  | "COMPLETED"
  | "FAILED"
  | "DIAGNOSING"
  | "TESTING"
  | "REPAIRING"
  | "REVIEWING"
  | "CANCELLED"
  | "INTERRUPTED"
  | "STOPPED";
export type AgentEvent = {
  id: string;
  sessionId: string;
  at: string;
  type:
    | "state"
    | "lifecycle"
    | "activity"
    | "text"
    | "tool"
    | "approval"
    | "error"
    | "done"
    | "command"
    | "verification"
    | "notice";
  /** Lifecycle state at the time of the event (see ./lifecycle.ts). */
  lifecycle?: SessionLifecycleState;
  /** User-facing activity classification used by the timeline UI. */
  activity?: AgentActivity;
  state?: AgentState;
  message?: string;
  detail?: string;
  toolCallId?: string;
  toolName?: string;
  changeId?: string;
  input?: unknown;
  result?: unknown;
  command?: string;
  action?: string;
  stream?: "stdout" | "stderr";
  chunk?: string;
  exitCode?: number;
  duration?: number;
  /** Stable request identifier for renderer-side event reconciliation. */
  requestId?: string;
  /** Monotonic sequence within one request; used to reject stale/out-of-order events. */
  seq?: number;
};
export type ChangeApprovalResult = {
  approved: boolean;
  status: "APPLIED" | "REJECTED" | "CONFLICT";
  message: string;
};
function validateToolArguments(tool: AgentTool, value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "Tool arguments must be a JSON object.";

  const schema = tool.inputSchema as {
    required?: unknown;
    properties?: Record<string, { type?: string }>;
  };
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string")
    : [];
  const object = value as Record<string, unknown>;
  for (const key of required) {
    if (!(key in object)) return `Missing required tool argument: ${key}`;
  }

  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    if (!(key in object) || object[key] === null || object[key] === undefined)
      continue;
    if (property?.type === "string" && typeof object[key] !== "string")
      return `Tool argument '${key}' must be a string.`;
    if (property?.type === "number" && typeof object[key] !== "number")
      return `Tool argument '${key}' must be a number.`;
    if (property?.type === "boolean" && typeof object[key] !== "boolean")
      return `Tool argument '${key}' must be a boolean.`;
    if (property?.type === "array" && !Array.isArray(object[key]))
      return `Tool argument '${key}' must be an array.`;
  }
  return null;
}

const BASE_SYSTEM = `You are G1Code Agent, an elite autonomous coding assistant embedded in an AI IDE (Antigravity-style). You have direct access to the user's local workspace via tools to investigate, edit, test, and deliver working solutions.

## Core Execution Discipline (Antigravity Standard)
1. **Targeted Investigation Over Unbounded Browsing**:
   - Inspect ONLY the 1–3 files directly relevant to the user's request.
   - Use 'get_project_info' or 'search_files' with specific keywords to locate target files immediately.
   - DO NOT browse or read dozens of files in an open-ended loop without taking action.
2. **Action-Oriented Workflow**:
   - Move swiftly from reading to acting. Once you understand the relevant code, formulate your changes and apply them with 'apply_patch' (for targeted edits) or 'write_file' (for new files).
   - If a prompt is broad (e.g., "fix all bugs/gaps"), identify the most critical issues, fix them decisively, verify with tests/lint, and report. Do not explore endlessly without making changes.
3. **Resilient Path Resolution**:
   - Always verify exact file paths and casing before reading. Check 'package.json' or use 'search_files' if you are unsure of where a configuration or source file lives.
   - If 'read_file' returns "File not found", do NOT repeatedly guess paths. Use 'search_files' with the basename or 'list_directory' to find the exact location in one step.
4. **Verification & Completion**:
   - After applying edits, always verify your changes using 'run_command' (e.g., npm test, tsc, or lint checks) or 'run_tests'.
   - When verified, STOP calling tools and provide a clear, concise final summary of:
     * Files modified
     * Problems identified and resolved
     * Test / verification results

## Available Tools
- read_file — Read any file (with optional line range)
- list_directory — List directory contents
- search_files — Full-text search across the workspace
- get_project_info — Project metadata (package.json scripts, README excerpt)
- write_file — Create or fully overwrite a file (goes through approval)
- apply_patch — SEARCH/REPLACE patch on an existing file (goes through approval)
- run_command — Execute shell commands (e.g. npm test, tsc, git, etc.)
- run_tests — Run project tests for changed files
- get_git_status — Complete git context (branch, modified files, recent commits)
- git_status / git_diff / git_branch / git_log — Read-only git information`;

async function buildSystemPrompt(
  workspace: string,
  mode: string,
): Promise<string> {
  const lines: string[] = [
    BASE_SYSTEM,
    "",
    `## Session Context`,
    `- Workspace: ${workspace}`,
    `- Mode: ${mode}`,
  ];
  // Inject package.json project info if available
  try {
    const { promises: fs } = await import("node:fs");
    const pkgRaw = await fs
      .readFile(`${workspace}/package.json`, "utf8")
      .catch(() => null);
    if (pkgRaw) {
      const pkg = JSON.parse(pkgRaw) as {
        name?: string;
        description?: string;
        scripts?: Record<string, string>;
      };
      if (pkg.name)
        lines.push(
          `- Project: ${pkg.name}${pkg.description ? ` — ${pkg.description}` : ""}`,
        );
      if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
        const scriptList = Object.entries(pkg.scripts)
          .slice(0, 8)
          .map(([k, v]) => `  • npm run ${k}`)
          .join("\n");
        lines.push(`- Available scripts:\n${scriptList}`);
      }
    }
  } catch {
    /* ignore */
  }
  if (mode === "ask")
    lines.push("- Instruction: CHAT ONLY — do not use tools.");
  else if (mode === "plan")
    lines.push(
      "- Instruction: INSPECT ONLY — list_directory and read_file are allowed; do NOT write or run commands.",
    );
  else
    lines.push(
      "- Instruction: Full autonomous agent — inspect, edit, and verify as needed.",
    );
  return lines.join("\n");
}

export class AgentRuntime {
  private state: AgentState = "IDLE";
  private stopped = false;
  private cancelledByUser = false;
  private toolCalls = 0;
  constructor(
    private readonly provider: AIProvider,
    private readonly tools: ToolRegistry,
    private readonly workspace: string,
    private readonly emit: (event: AgentEvent) => void,
    private readonly approve: (
      tool: AgentTool,
      input: unknown,
      toolCallId?: string,
    ) => Promise<boolean>,
    private readonly limits = {
      maxIterations: 50,
      maxToolCalls: 150,
      maxExecutionTime: 20 * 60_000,
      maxRepairAttempts: 5,
      commandTimeoutMs: 120000,
      toolTimeoutMs: 120000,
      maxRetries: 3,
    },
    private readonly sessionId = "",
    private readonly changeService?: import("../tools/change-service").ChangeService,
    private readonly waitForChangeApproval?: (
      changeId: string,
    ) => Promise<ChangeApprovalResult>,
    private readonly contextRecordTestRun?: (run: {
      command: string;
      cwd: string;
      targeted: boolean;
      exitCode?: number;
      passed?: boolean;
      stdout?: string;
      stderr?: string;
      duration?: number;
    }) => void,
    private readonly recordRepairAttempt?: (attempt: {
      attemptNumber: number;
      diagnosis: string;
      evidence: unknown;
      result: string;
    }) => void,
    private readonly model: string = "",
    private readonly requestId: string = randomUUID(),
  ) {}
  private repairAttempts = 0;
  private eventSequence = 0;
  private session?: AgentSession;
  /**
   * Permission decisions for the current run, keyed by tool call id.
   *
   * The runtime asks the permission authority *before* executing any
   * non-read-only tool and caches the answer, so a tool that also calls
   * `context.approve` cannot cause a second prompt and, more importantly, a
   * tool can never bypass the permission layer by simply not asking.
   */
  private readonly toolDecisions = new Map<string, boolean>();
  /**
   * Coalesces streamed text so a chatty provider cannot create one persistence
   * row (and one renderer event) per token. Flushed on tool calls, on
   * completion, and on cancellation.
   */
  private assistantBuffer = new BoundedTextBuffer(4096, (text) => {
    this.emitText(text);
  });
  private iterations = 0;
  private callCount = 0;
  private streamedCharacters = 0;

  /**
   * Phase 4: the manager creates the session (and therefore the AbortController
   * and the cleanup registry) and attaches it here before `run`. Attaching is
   * separate from the constructor so the runtime keeps working standalone in
   * tests and older call sites.
   */
  attachSession(session: AgentSession) {
    this.session = session;
  }

  iterationCount() {
    return this.iterations;
  }
  toolCallCount() {
    return this.callCount;
  }
  get cancelled(): boolean {
    return this.session
      ? this.session.lifecycle.cancelRequested
      : this.stopped || this.cancelledByUser;
  }
  private get signal(): AbortSignal | undefined {
    return this.session?.signal;
  }
  /** Emit a lifecycle event and keep the runtime's own flag in sync. */
  private setLifecycle(state: SessionLifecycleState, reason?: string) {
    this.event({ type: "lifecycle", lifecycle: state, message: reason });
  }

  private isCancelled(signal?: AbortSignal): boolean {
    return Boolean(signal?.aborted) || this.stopped || this.cancelled;
  }

  private transitionCancellation(signal?: AbortSignal) {
    const byUser =
      this.cancelledByUser || this.session?.lifecycle.cancelRequested;
    if (this.session) {
      this.setLifecycle("cancelling", "cancellation observed by runtime");
      this.session.markCancelled("cancelled by user");
      this.setLifecycle("cancelled", "cancelled by user");
      this.state = "CANCELLED";
      this.event({
        type: "state",
        state: "CANCELLED",
        activity: "result",
        message: byUser ? "Agent cancelled by user" : "Agent stopped by user",
      });
      return;
    }
    this.transition(
      byUser ? "CANCELLED" : "STOPPED",
      byUser ? "Agent cancelled by user" : "Agent stopped by user",
    );
  }

  /** Terminal bookkeeping shared by every exit path. */
  private finishSession(
    outcome: "completed" | "failed" | "cancelled",
    reason?: string,
  ) {
    this.wakeDecisionWaiters();
    this.flushAssistantBuffer();
    if (!this.session) return;
    if (outcome === "completed") this.session.markCompleted(reason);
    else if (outcome === "failed") this.session.markFailed(reason);
    else this.session.markCancelled(reason);
    this.setLifecycle(outcome, reason);
  }

  private flushAssistantBuffer() {
    const flushed = this.assistantBuffer.drain();
    if (flushed) this.emitText(flushed);
  }

  private emitText(text: string) {
    if (!text) return;
    this.event({ type: "text", activity: "response", message: text });
  }
  /**
   * Approval callbacks normally live in the main process and are released by
   * the session manager. Keeping a local wake-up set as well makes the runtime
   * safe when it is used without that manager (and prevents a cancelled run
   * from waiting forever on a renderer decision).
   */
  private readonly pendingDecisionWakeups = new Set<() => void>();

  /**
   * Idempotent stop. With an attached session this requests cancellation
   * through the lifecycle (which aborts the signal, kills tracked children, and
   * runs cleanups); repeated calls are no-ops.
   */
  stop() {
    this.stopped = true;
    this.cancelledByUser = true;
    if (this.session) {
      if (!this.session.lifecycle.cancelRequested) {
        this.session.requestCancel("stopped by user");
        this.setLifecycle("cancelling", "stopped by user");
      }
    }
    this.wakeDecisionWaiters();
  }

  private wakeDecisionWaiters() {
    for (const wakeup of [...this.pendingDecisionWakeups]) wakeup();
    this.pendingDecisionWakeups.clear();
  }

  private async waitForDecision<T>(
    decision: Promise<T>,
    signal: AbortSignal | undefined,
    cancelledValue: T,
  ): Promise<T> {
    if (this.stopped || signal?.aborted) return cancelledValue;

    return new Promise<T>((resolve) => {
      let settled = false;
      const finish = (value: T) => {
        if (settled) return;
        settled = true;
        this.pendingDecisionWakeups.delete(cancel);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const cancel = () => finish(cancelledValue);
      const onAbort = () => finish(cancelledValue);

      this.pendingDecisionWakeups.add(cancel);
      const unregister = this.session?.register(() => finish(cancelledValue));
      if (signal) {
        if (signal.aborted) {
          finish(cancelledValue);
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      decision.then(finish).catch(() => finish(cancelledValue));

      if (this.session) {
        // Belt and braces: releasing the global waiter set must also unregister
        // this wake-up so a cancelled session leaves nothing behind.
        this.session.register(() => {
          this.pendingDecisionWakeups.delete(cancel);
          finish(cancelledValue);
        });
      }
      void unregister;
    });
  }
  /**
   * Mandatory pre-execution permission check.
   *
   * `safe` tools (reads) run directly. Every other tool goes through the
   * approval callback, which is backed by the permission policy in the server.
   */
  private async ensurePermission(
    tool: AgentTool,
    input: unknown,
    toolCallId: string,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    if (tool.permission === "safe") return true;
    const cached = this.toolDecisions.get(toolCallId);
    if (cached !== undefined) return cached;

    const applyWaiter = async () => {
      if (!this.approve) return true;
      this.transition(
        "WAITING_FOR_APPROVAL",
        `Waiting for approval of ${tool.name}`,
      );
      if (this.session && !this.session.terminal) {
        this.session.lifecycle.transition(
          "waiting_for_approval",
          `approval requested for ${tool.name}`,
        );
        this.setLifecycle(
          "waiting_for_approval",
          `approval requested for ${tool.name}`,
        );
      }
      this.event({
        type: "approval",
        toolCallId,
        toolName: tool.name,
        input: redactObject(input),
        action: "requested",
        activity: "approval",
        message: `Approval required for ${tool.name}`,
      });
      let promise: Promise<boolean>;
      try {
        promise = Promise.resolve(this.approve(tool, input, toolCallId));
      } catch {
        promise = Promise.resolve(false);
      }
      const allowed = await this.waitForDecision(promise, signal, false);
      const cancelled = this.stopped || Boolean(signal?.aborted);
      const decided = allowed && !cancelled;
      this.event({
        type: "approval",
        toolCallId,
        toolName: tool.name,
        input: redactObject(input),
        action: "resolved",
        activity: "approval",
        result: {
          status: decided ? "APPROVED" : "REJECTED",
          approved: decided,
        },
        message: cancelled
          ? `Approval cancelled for ${tool.name}`
          : decided
            ? `${tool.name} approved`
            : `${tool.name} rejected or denied by policy`,
      });
      if (!cancelled) {
        this.transition(
          "EXECUTING",
          decided ? `${tool.name} approved` : `${tool.name} denied`,
        );
        if (this.session && this.session.state === "waiting_for_approval") {
          this.session.lifecycle.transition("running", "approval resolved");
          this.setLifecycle("running", "approval resolved");
        }
      }
      return decided;
    };

    const allowed = await applyWaiter();
    this.toolDecisions.set(toolCallId, allowed);
    return allowed;
  }

  private transition(state: AgentState, message: string) {
    this.state = state;
    this.event({ type: "state", state, message });
  }
  private event(event: Omit<AgentEvent, "id" | "at" | "sessionId">) {
    this.emit({
      ...event,
      id: randomUUID(),
      sessionId: this.sessionId,
      requestId: this.requestId,
      seq: ++this.eventSequence,
      at: new Date().toISOString(),
    });
  }
  async run(
    prompt: string,
    mode: "ask" | "plan" | "agent",
    signal?: AbortSignal,
    attachedContext: string[] = [],
    conversationHistory: ChatMessage[] = [],
  ) {
    const started = Date.now();
    // A session owns cancellation for its whole lifetime; the legacy booleans
    // below still support manager-less (test) usage.
    this.stopped = false;
    this.cancelledByUser = false;
    this.toolCalls = 0;
    this.callCount = 0;
    this.iterations = 0;
    this.streamedCharacters = 0;
    this.repairAttempts = 0;
    this.eventSequence = 0;
    this.toolDecisions.clear();
    this.pendingDecisionWakeups.clear();
    const effectiveSignal = this.session?.signal ?? signal;
    if (this.session) {
      this.session.lifecycle.transition("running", "run started");
      this.setLifecycle("running", "run started");
    } else {
      this.state = "RUNNING";
    }

    // Capability check: If model explicitly does not support tools in agent mode
    if (
      mode === "agent" &&
      this.model &&
      this.provider.supportsTools &&
      !this.provider.supportsTools(this.model)
    ) {
      this.transition("FAILED", "Model does not support tools");
      this.event({
        type: "error",
        message: `Model '${this.model}' does not support tool calls. Switch to a Tools-capable model or use Ask mode.`,
      });
      this.finishSession("failed", "Model does not support tools");
      return;
    }

    const systemPrompt = await buildSystemPrompt(this.workspace, mode);

    // Build user message — prepend any attached context file snippets
    let userContent = prompt;
    if (attachedContext.length > 0) {
      userContent = `## Attached Context\n${attachedContext.join("\n\n")}\n\n## Task\n${prompt}`;
    }

    // Reuse the durable conversation when a user continues an existing chat.
    // Only provider-compatible messages are accepted here; persisted chat
    // history intentionally contains user/assistant turns and never renderer
    // state or approval metadata.
    const history = conversationHistory
      .filter(
        (message) =>
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string" &&
          message.content.trim().length > 0,
      )
      .slice(-40);
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: userContent },
    ];
    const definitions: ToolDefinition[] =
      mode === "ask"
        ? []
        : this.tools
            .all()
            .filter(
              (tool) =>
                mode === "agent" ||
                ["read_file", "list_directory", "search_files"].includes(
                  tool.name,
                ),
            )
            .map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            }));
    this.transition("UNDERSTANDING", "Understanding request");
    let activeModel =
      this.model ||
      globalModelCatalog.getFreeModels()[0]?.id ||
      globalModelCatalog.getModels()[0]?.id ||
      "";
    const restrictedModels = new Set<string>();
    for (
      let iteration = 0;
      iteration < this.limits.maxIterations;
      iteration += 1
    ) {
      if (this.isCancelled(effectiveSignal)) {
        this.transitionCancellation(effectiveSignal);
        return;
      }
      if (
        Date.now() - started > this.limits.maxExecutionTime ||
        this.toolCalls >= this.limits.maxToolCalls
      ) {
        this.transition("FAILED", "Task execution budget reached");
        this.event({
          type: "error",
          activity: "result",
          message: `The agent reached the safety budget for this task (${this.toolCalls} tool calls). You can prompt it to continue from where it left off.`,
        });
        this.finishSession("failed", "execution budget reached");
        return;
      }
      if (iteration > 0) this.transition("OBSERVING", "Reviewing tool results");
      this.iterations += 1;
      let text = "";
      const calls = new Map<string, ToolCall>();
      let streamSucceeded = false;
      const maxStreamAttempts = Math.max(1, this.limits.maxRetries ?? 3);

      for (let attempt = 0; attempt < maxStreamAttempts; attempt++) {
        text = "";
        calls.clear();
        let attemptText = "";
        // Reasoning deltas are never persisted or displayed; the UI only needs
        // to know that the model is thinking so it can show an activity state.
        let reasoningChars = 0;
        try {
          for await (const chunk of this.provider.streamChat({
            model: activeModel,
            messages,
            tools: definitions,
            temperature: 0.2,
            maxTokens: 4096,
            signal: effectiveSignal,
          })) {
            if (chunk.reasoning) {
              reasoningChars += chunk.reasoning.length;
              if (reasoningChars > 0 && !text) {
                this.event({
                  type: "activity",
                  activity: "thinking",
                  message: "Model is reasoning about the task",
                  detail: `${reasoningChars} reasoning characters received (content is not stored)`,
                });
              }
            }
            if (chunk.content) {
              attemptText += chunk.content;
              this.streamedCharacters += chunk.content.length;
              this.assistantBuffer.push(chunk.content);
            }
            for (const call of chunk.toolCalls ?? []) calls.set(call.id, call);
          }
          text = attemptText;
          streamSucceeded = true;
          break;
        } catch (error) {
          if (this.isCancelled(effectiveSignal)) {
            this.transitionCancellation(effectiveSignal);
            return;
          }

          const errorMsg =
            error instanceof Error ? error.message : String(error);
          const isRateLimitOrUnavailable =
            errorMsg.includes("429") ||
            errorMsg.toLowerCase().includes("rate limit") ||
            errorMsg.includes("404") ||
            errorMsg.includes("503") ||
            errorMsg.toLowerCase().includes("unavailable") ||
            errorMsg.toLowerCase().includes("limit reached");

          if (isRateLimitOrUnavailable && attempt < maxStreamAttempts - 1) {
            restrictedModels.add(activeModel);
            const nextBest = globalModelCatalog.getNextBestFreeModel(
              activeModel,
              restrictedModels,
            );
            if (nextBest && nextBest.id !== activeModel) {
              // Emit as a dedicated notice (NOT a text chunk) so the UI can render
              // it as a system banner without swallowing the following reply.
              this.event({
                type: "notice",
                message: `Model "${activeModel}" encountered an issue (${errorMsg.slice(0, 100)}). Switched automatically to "${nextBest.name || nextBest.id}".`,
                detail: nextBest.id,
              });
              activeModel = nextBest.id;
              continue;
            }
          }

          if (attemptText) {
            // Preserve the assistant text that did arrive before the failure.
            text = attemptText;
            this.flushAssistantBuffer();
          }
          this.transition("FAILED", "Provider request failed");
          this.event({
            type: "error",
            activity: "result",
            message: `${maxStreamAttempts > 1 ? `Stream terminated unexpectedly after ${attempt + 1}/${maxStreamAttempts} attempts: ` : ""}${errorMsg}`,
          });
          this.finishSession("failed", "provider stream failed");
          return;
        }
      }

      if (!streamSucceeded) {
        return;
      }
      const toolCalls = [...calls.values()];
      if (!toolCalls.length) {
        // No tool calls — push a plain assistant message (no toolCalls field)
        messages.push({ role: "assistant", content: text });
        this.transition("COMPLETED", "Task completed");
        this.flushAssistantBuffer();
        this.event({ type: "done", activity: "result", message: text });
        this.finishSession("completed", "task completed");
        return;
      }
      // Tool calls present: flush coalesced assistant text before the tool
      // activity begins so the timeline order is preserved.
      this.flushAssistantBuffer();
      // Tool calls present — include them in the assistant message
      messages.push({ role: "assistant", content: text, toolCalls });
      this.transition(
        mode === "plan" ? "ANALYZING" : "EXECUTING",
        `${toolCalls.length} tool request${toolCalls.length === 1 ? "" : "s"}`,
      );
      for (const call of toolCalls) {
        const tool = this.tools.get(call.name);
        if (!tool) {
          const message = `Unknown tool: ${call.name}`;
          this.event({
            type: "error",
            toolCallId: call.id,
            toolName: call.name,
            message,
          });
          this.event({
            type: "tool",
            toolCallId: call.id,
            toolName: call.name,
            result: { isError: true, content: message },
            message: `${call.name} failed`,
          });
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: message,
          });
          continue;
        }
        this.toolCalls += 1;
        this.callCount += 1;
        const argumentError = validateToolArguments(tool, call.arguments);
        if (argumentError) {
          this.event({
            type: "error",
            toolCallId: call.id,
            toolName: call.name,
            message: argumentError,
          });
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: JSON.stringify({ isError: true, error: argumentError }),
          });
          continue;
        }
        const sanitizedInput = redactObject(call.arguments);
        this.event({
          type: "tool",
          toolCallId: call.id,
          toolName: call.name,
          input: sanitizedInput,
          activity: "tool",
          message: `Running ${call.name}`,
        });
        // The runtime — not the tool — decides whether a call may proceed.
        const permitted = await this.ensurePermission(
          tool,
          call.arguments,
          call.id,
          signal,
        );
        if (!permitted) {
          if (this.isCancelled(signal)) {
            this.transitionCancellation(signal);
            return;
          }
          const denial = `Permission denied for tool '${call.name}'. Do not retry it; ask the user to enable the required permission or choose a read-only approach.`;
          this.event({
            type: "tool",
            toolCallId: call.id,
            toolName: call.name,
            activity: "tool",
            result: { isError: true, content: denial },
            message: `${call.name} was not permitted`,
          });
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: JSON.stringify({ isError: true, error: denial }),
          });
          continue;
        }

        const context: ToolContext = {
          workspace: this.workspace,
          toolCallId: call.id,
          approve: async (requested, input) => {
            // A tool's own approval request reuses the cached, authoritative
            // decision for this call instead of prompting twice.
            const cached = this.toolDecisions.get(call.id);
            if (cached !== undefined) return cached;
            return this.ensurePermission(requested, input, call.id, signal);
          },
          emit: (event) =>
            this.event({
              type:
                event.type.toLowerCase().includes("command") ||
                event.type === "command"
                  ? "command"
                  : event.type === "verification"
                    ? "verification"
                    : "tool",
              activity:
                event.type === "CHANGE_PROPOSED"
                  ? "file_change"
                  : event.type.toLowerCase().includes("command") ||
                      event.type === "command"
                    ? "command"
                    : event.type === "verification"
                      ? "verification"
                      : "tool",
              toolName: call.name,
              toolCallId: event.toolCallId || call.id,
              command: event.command,
              action: event.action,
              stream: event.stream,
              chunk: event.chunk ? redactSecrets(event.chunk) : undefined,
              exitCode: event.exitCode,
              duration: event.duration,
              message: redactSecrets(event.message),
              detail: event.detail ? redactSecrets(event.detail) : undefined,
            }),
          signal: effectiveSignal,
          commandTimeoutMs: this.limits.commandTimeoutMs,
          toolTimeoutMs: this.limits.toolTimeoutMs,
          changeService: this.changeService,
          sessionId: this.sessionId,
          registerCleanup: (cleanup) => {
            this.session?.register(cleanup);
          },
          trackProcess: (child) => {
            this.session?.trackChild(child);
          },
          recordTestRun: (run) => this.contextRecordTestRun?.(run),
        };
        try {
          const result = await tool.execute(call.arguments, context);
          const sanitizedResult = redactObject(result);
          this.event({
            type: "tool",
            toolCallId: call.id,
            toolName: call.name,
            result: sanitizedResult,
            activity:
              result.status === "pending_approval" ? "file_change" : "tool",
            message: result.isError
              ? `${call.name} failed`
              : result.status === "pending_approval"
                ? `${call.name} proposed a change for review`
                : `${call.name} completed`,
          });
          if (result.status === "pending_approval" && result.changeId) {
            this.transition(
              "WAITING_FOR_CHANGE_APPROVAL",
              `Waiting for approval of ${result.path ?? result.changeId}`,
            );
            if (this.session && !this.session.terminal) {
              this.session.lifecycle.transition(
                "waiting_for_approval",
                `change ${result.path ?? result.changeId} awaiting approval`,
              );
              this.setLifecycle(
                "waiting_for_approval",
                `change ${result.path ?? result.changeId} awaiting approval`,
              );
            }
            this.event({
              type: "approval",
              toolCallId: call.id,
              toolName: call.name,
              input: result,
              message: "Change requires user approval",
            });
            const decision = this.waitForChangeApproval
              ? await this.waitForDecision(
                  this.waitForChangeApproval(result.changeId),
                  signal,
                  {
                    approved: false,
                    status: "REJECTED" as const,
                    message: "Change approval cancelled.",
                  },
                )
              : {
                  approved: false,
                  status: "REJECTED" as const,
                  message: "No approval channel is available.",
                };
            const cancelled = this.stopped || signal?.aborted;
            this.event({
              type: "approval",
              toolCallId: call.id,
              toolName: call.name,
              changeId: result.changeId,
              input: result,
              action: "resolved",
              result: { status: decision.status },
              message: cancelled
                ? "Change approval cancelled."
                : decision.message,
            });
            if (!cancelled) {
              this.transition("EXECUTING", decision.message);
              if (
                this.session &&
                this.session.state === "waiting_for_approval"
              ) {
                this.session.lifecycle.transition("running", "change resolved");
                this.setLifecycle("running", "change resolved");
              }
            }
            messages.push({
              role: "tool",
              toolCallId: call.id,
              content: JSON.stringify({
                status: decision.status.toLowerCase(),
                changeId: result.changeId,
                message: decision.message,
              }),
            });
            continue;
          }
          if (call.name === "run_tests" && result.isError) {
            this.repairAttempts += 1;
            this.recordRepairAttempt?.({
              attemptNumber: this.repairAttempts,
              diagnosis:
                "Test command failed; model diagnosis is required before another repair.",
              evidence: result.content,
              result:
                this.repairAttempts >= this.limits.maxRepairAttempts
                  ? "LIMIT_REACHED"
                  : "FAILED",
            });
            this.transition(
              "DIAGNOSING",
              `Tests failed; diagnosing repair attempt ${this.repairAttempts}/${this.limits.maxRepairAttempts}`,
            );
            this.event({
              type: "verification",
              activity: "verification",
              toolName: call.name,
              message:
                this.repairAttempts >= this.limits.maxRepairAttempts
                  ? "Self-repair limit reached."
                  : "Tests failed. The agent must diagnose the failure before proposing a repair.",
              result: {
                attempt: this.repairAttempts,
                limit: this.limits.maxRepairAttempts,
                status: "FAILED",
              },
            });
            if (this.repairAttempts >= this.limits.maxRepairAttempts) {
              this.transition("FAILED", "Self-repair limit reached");
              return;
            }
            this.transition(
              "REPAIRING",
              "Preparing a model-driven repair proposal",
            );
          }
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: result.content,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.event({
            type: "error",
            toolCallId: call.id,
            toolName: call.name,
            message,
          });
          this.event({
            type: "tool",
            toolCallId: call.id,
            toolName: call.name,
            result: { isError: true, content: message },
            message: `${call.name} failed`,
          });
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: `Tool error: ${message}`,
          });
        }
      }
    }
    this.transition("FAILED", "Iteration budget reached");
    this.event({
      type: "error",
      activity: "result",
      message: `The agent completed its allotted execution turns (${this.limits.maxIterations} iterations). You can prompt it to continue with the next step.`,
    });
    this.finishSession("failed", "iteration budget reached");
  }
}
