import { randomUUID } from "node:crypto";
import { AIProvider, ChatMessage, ToolCall, ToolDefinition } from "../ai/types";
import { globalModelCatalog } from "../ai/models";
import { AgentTool, ToolContext, ToolRegistry } from "../tools/types";
import { redactObject, redactSecrets } from "../security/redaction";

export type AgentState =
  | "IDLE"
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
    | "text"
    | "tool"
    | "approval"
    | "error"
    | "done"
    | "command"
    | "notice";
  state?: AgentState;
  message?: string;
  detail?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  result?: unknown;
  command?: string;
  action?: string;
  stream?: "stdout" | "stderr";
  chunk?: string;
  exitCode?: number;
  duration?: number;
};
export type ChangeApprovalResult = {
  approved: boolean;
  status: "APPLIED" | "REJECTED" | "CONFLICT";
  message: string;
};
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
  private cancelled = false;
  private toolCalls = 0;
  constructor(
    private readonly provider: AIProvider,
    private readonly tools: ToolRegistry,
    private readonly workspace: string,
    private readonly emit: (event: AgentEvent) => void,
    private readonly approve: (
      tool: AgentTool,
      input: unknown,
    ) => Promise<boolean>,
    private readonly limits = {
      maxIterations: 50,
      maxToolCalls: 150,
      maxExecutionTime: 20 * 60_000,
      maxRepairAttempts: 5,
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
  ) {}
  private repairAttempts = 0;
  stop() {
    this.stopped = true;
    this.cancelled = true;
  }
  private transition(state: AgentState, message: string) {
    this.state = state;
    this.emit({
      id: randomUUID(),
      sessionId: this.sessionId,
      at: new Date().toISOString(),
      type: "state",
      state,
      message,
    });
  }
  private event(event: Omit<AgentEvent, "id" | "at" | "sessionId">) {
    this.emit({
      ...event,
      id: randomUUID(),
      sessionId: this.sessionId,
      at: new Date().toISOString(),
    });
  }
  async run(
    prompt: string,
    mode: "ask" | "plan" | "agent",
    signal?: AbortSignal,
    attachedContext: string[] = [],
  ) {
    const started = Date.now();
    this.stopped = false;
    this.cancelled = false;
    this.toolCalls = 0;
    this.repairAttempts = 0;

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
      return;
    }

    const systemPrompt = await buildSystemPrompt(this.workspace, mode);

    // Build user message — prepend any attached context file snippets
    let userContent = prompt;
    if (attachedContext.length > 0) {
      userContent = `## Attached Context\n${attachedContext.join("\n\n")}\n\n## Task\n${prompt}`;
    }

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
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
      if (this.stopped || signal?.aborted) {
        this.transition(
          this.cancelled ? "CANCELLED" : "STOPPED",
          this.cancelled ? "Agent cancelled by user" : "Agent stopped by user",
        );
        return;
      }
      if (
        Date.now() - started > this.limits.maxExecutionTime ||
        this.toolCalls >= this.limits.maxToolCalls
      ) {
        this.transition("FAILED", "Task execution budget reached");
        this.event({
          type: "error",
          message: `The agent reached the safety budget for this task (${this.toolCalls} tool calls). You can prompt it to continue from where it left off.`,
        });
        return;
      }
      if (iteration > 0) this.transition("OBSERVING", "Reviewing tool results");
      let text = "";
      const calls = new Map<string, ToolCall>();
      let streamSucceeded = false;
      const maxStreamAttempts = 3;

      for (let attempt = 0; attempt < maxStreamAttempts; attempt++) {
        text = "";
        calls.clear();
        try {
          for await (const chunk of this.provider.streamChat({
            model: activeModel,
            messages,
            tools: definitions,
            temperature: 0.2,
            maxTokens: 4096,
            signal,
          })) {
            if (chunk.content) {
              text += chunk.content;
              this.event({ type: "text", message: chunk.content });
            }
            for (const call of chunk.toolCalls ?? []) calls.set(call.id, call);
          }
          streamSucceeded = true;
          break;
        } catch (error) {
          if (signal?.aborted || this.stopped) {
            this.transition(
              this.cancelled ? "CANCELLED" : "STOPPED",
              this.cancelled
                ? "Agent cancelled by user"
                : "Agent stopped by user",
            );
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

          this.transition("FAILED", "Provider request failed");
          this.event({
            type: "error",
            message: errorMsg,
          });
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
        this.event({ type: "done", message: text });
        return;
      }
      // Tool calls present — include them in the assistant message
      messages.push({ role: "assistant", content: text, toolCalls });
      this.transition(
        mode === "plan" ? "ANALYZING" : "EXECUTING",
        `${toolCalls.length} tool request${toolCalls.length === 1 ? "" : "s"}`,
      );
      for (const call of toolCalls) {
        const tool = this.tools.get(call.name);
        if (!tool) {
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: `Unknown tool: ${call.name}`,
          });
          continue;
        }
        this.toolCalls += 1;
        const sanitizedInput = redactObject(call.arguments);
        this.event({
          type: "tool",
          toolCallId: call.id,
          toolName: call.name,
          input: sanitizedInput,
          message: `Running ${call.name}`,
        });
        const context: ToolContext = {
          workspace: this.workspace,
          toolCallId: call.id,
          approve: async (requested, input) => {
            this.event({
              type: "approval",
              toolName: requested.name,
              input: redactObject(input),
              message: `Approval required for ${requested.name}`,
            });
            return this.approve(requested, input);
          },
          emit: (event) =>
            this.event({
              type:
                event.type.toLowerCase().includes("command") ||
                event.type === "command"
                  ? "command"
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
          signal,
          changeService: this.changeService,
          sessionId: this.sessionId,
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
            message: result.isError
              ? `${call.name} failed`
              : `${call.name} completed`,
          });
          if (result.status === "pending_approval" && result.changeId) {
            this.transition(
              "WAITING_FOR_CHANGE_APPROVAL",
              `Waiting for approval of ${result.path ?? result.changeId}`,
            );
            this.event({
              type: "approval",
              toolCallId: call.id,
              toolName: call.name,
              input: result,
              message: "Change requires user approval",
            });
            const decision = this.waitForChangeApproval
              ? await this.waitForChangeApproval(result.changeId)
              : {
                  approved: false,
                  status: "REJECTED" as const,
                  message: "No approval channel is available.",
                };
            this.transition("EXECUTING", decision.message);
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
              type: "error",
              toolName: call.name,
              message:
                this.repairAttempts >= this.limits.maxRepairAttempts
                  ? "Self-repair limit reached."
                  : "Tests failed. The agent must diagnose the failure before proposing a repair.",
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
          this.event({ type: "error", toolName: call.name, message });
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
      message: `The agent completed its allotted execution turns (${this.limits.maxIterations} iterations). You can prompt it to continue with the next step.`,
    });
  }
}
