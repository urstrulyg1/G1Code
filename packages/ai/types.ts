export type Role = "system" | "user" | "assistant" | "tool";
export type ChatMessage = {
  role: Role;
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
};
export type AIModel = {
  id: string;
  name: string;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
};
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};
export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};
export type ToolResult = {
  toolCallId: string;
  content: string;
  isError?: boolean;
};
export type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};
export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};
export type ChatResponse = {
  message: ChatMessage;
  usage?: Usage;
  requestId?: string;
};
export type ChatChunk = {
  content?: string;
  toolCalls?: ToolCall[];
  done?: boolean;
  usage?: Usage;
};
export type ProviderConfig = {
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
};
export interface AIProvider {
  getModels(signal?: AbortSignal): Promise<AIModel[]>;
  chat(request: ChatRequest): Promise<ChatResponse>;
  streamChat(request: ChatRequest): AsyncIterable<ChatChunk>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
