import { randomUUID } from "node:crypto";
import { AIProvider, ChatMessage, ToolCall, ToolDefinition } from "../ai/types";
import { globalModelCatalog } from "../ai/models";
import { AgentTool, ToolContext, ToolRegistry } from "../tools/types";

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
  type: "state" | "text" | "tool" | "approval" | "error" | "done" | "command";
  state?: AgentState;
  message?: string;
  detail?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  result?: unknown;
};
export type ChangeApprovalResult = {
  approved: boolean;
  status: "APPLIED" | "REJECTED" | "CONFLICT";
  message: string;
};
const system = `You are G1Code Agent, an autonomous coding assistant. Work only inside the supplied workspace. Inspect before editing. Prefer apply_patch for small changes. Explain briefly, use tools when needed, and verify edits with tests or a relevant command. Never claim a tool ran unless its result is provided.`;

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
      maxIterations: 30,
      maxToolCalls: 100,
      maxExecutionTime: 15 * 60_000,
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
        message: `Model '${this.model}' cannot run autonomous coding tools. Use Chat/Ask mode or select a tool-capable model.`,
      });
      return;
    }

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `${system}\nWorkspace: ${this.workspace}\nMode: ${mode}. ${mode === "ask" ? "Do not use tools." : mode === "plan" ? "You may inspect only. Do not modify files or run commands." : "You may use approved tools."}`,
      },
      { role: "user", content: prompt },
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
        this.transition("FAILED", "Agent execution limit reached");
        this.event({
          type: "error",
          message: "Agent execution limit reached. The agent stopped safely.",
        });
        return;
      }
      if (iteration > 0) this.transition("OBSERVING", "Reviewing tool results");
      let text = "";
      const calls = new Map<string, ToolCall>();
      try {
        for await (const chunk of this.provider.streamChat({
          model:
            this.model ||
            globalModelCatalog.getFreeModels()[0]?.id ||
            globalModelCatalog.getModels()[0]?.id ||
            "",
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
        this.transition("FAILED", "Provider request failed");
        this.event({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      const toolCalls = [...calls.values()];
      messages.push({ role: "assistant", content: text, toolCalls });
      if (!toolCalls.length) {
        this.transition("COMPLETED", "Task completed");
        this.event({ type: "done", message: text });
        return;
      }
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
        this.event({
          type: "tool",
          toolCallId: call.id,
          toolName: call.name,
          input: call.arguments,
          message: `Running ${call.name}`,
        });
        const context: ToolContext = {
          workspace: this.workspace,
          approve: async (requested, input) => {
            this.event({
              type: "approval",
              toolName: requested.name,
              input,
              message: `Approval required for ${requested.name}`,
            });
            return this.approve(requested, input);
          },
          emit: (event) =>
            this.event({
              type: event.type === "command" ? "command" : "tool",
              toolName: call.name,
              message: event.message,
              detail: event.detail,
            }),
          signal,
          changeService: this.changeService,
          sessionId: this.sessionId,
          recordTestRun: (run) => this.contextRecordTestRun?.(run),
        };
        try {
          const result = await tool.execute(call.arguments, context);
          this.event({
            type: "tool",
            toolCallId: call.id,
            toolName: call.name,
            result,
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
    this.transition("FAILED", "Maximum repair iterations reached");
    this.event({
      type: "error",
      message: "The agent stopped safely after reaching its iteration limit.",
    });
  }
}
