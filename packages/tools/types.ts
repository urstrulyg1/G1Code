export type PermissionLevel = "safe" | "moderate" | "dangerous";
export type PermissionDecision = "allow" | "ask" | "deny";
export type ToolContext = {
  workspace: string;
  toolCallId?: string;
  approve: (tool: AgentTool, input: unknown) => Promise<boolean>;
  emit: (event: {
    type: string;
    message: string;
    detail?: string;
    toolCallId?: string;
    command?: string;
    action?: string;
    stream?: "stdout" | "stderr";
    chunk?: string;
    exitCode?: number;
    duration?: number;
  }) => void;
  signal?: AbortSignal;
  changeService?: import("./change-service").ChangeService;
  sessionId?: string;
  recordTestRun?: (run: {
    command: string;
    cwd: string;
    targeted: boolean;
    exitCode?: number;
    passed?: boolean;
    stdout?: string;
    stderr?: string;
    duration?: number;
  }) => void;
};
export type ToolResult = {
  content: string;
  isError?: boolean;
  exitCode?: number;
  status?: "pending_approval" | "completed" | "rejected" | "conflict";
  changeId?: string;
  path?: string;
  diff?: string;
  duration?: number;
  stdout?: string;
  stderr?: string;
  lineCount?: number;
  matchesCount?: number;
};
export type AgentTool = {
  name: string;
  description: string;
  permission: PermissionLevel;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, context: ToolContext) => Promise<ToolResult>;
};
export class ToolRegistry {
  private tools = new Map<string, AgentTool>();
  register(tool: AgentTool) {
    this.tools.set(tool.name, tool);
  }
  get(name: string) {
    return this.tools.get(name);
  }
  all() {
    return [...this.tools.values()];
  }
}
