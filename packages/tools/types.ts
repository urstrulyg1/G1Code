export type PermissionLevel = 'safe' | 'moderate' | 'dangerous';
export type PermissionDecision = 'allow' | 'ask' | 'deny';
export type ToolContext = { workspace: string; approve: (tool: AgentTool, input: unknown) => Promise<boolean>; emit: (event: { type: string; message: string; detail?: string }) => void; signal?: AbortSignal };
export type ToolResult = { content: string; isError?: boolean; exitCode?: number };
export type AgentTool = { name: string; description: string; permission: PermissionLevel; inputSchema: Record<string, unknown>; execute: (input: unknown, context: ToolContext) => Promise<ToolResult> };
export class ToolRegistry { private tools = new Map<string, AgentTool>(); register(tool: AgentTool) { this.tools.set(tool.name, tool); } get(name: string) { return this.tools.get(name); } all() { return [...this.tools.values()]; } }
