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
  contextWindowFormatted?: string;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  supportsVision?: boolean;
  isPromotional?: boolean;
  description?: string;
  pricingType?: "free" | "promotional" | "credits" | "paid" | "unknown";
  pricingFormatted?: string;
  pricingDetails?: {
    input?: number;
    output?: number;
  };
  recommendedRole?: string;
  apiRank?: number;
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
  latencyMs?: number;
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
  id?: string;
  name?: string;
  getModels(signal?: AbortSignal): Promise<AIModel[]>;
  listModels?(signal?: AbortSignal): Promise<AIModel[]>;
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream?(request: ChatRequest): AsyncIterable<ChatChunk>;
  streamChat(request: ChatRequest): AsyncIterable<ChatChunk>;
  supportsTools?(model: string): boolean;
  supportsVision?(model: string): boolean;
  verifyConnection?(): Promise<{
    connected: boolean;
    modelCount: number;
    message: string;
  }>;
  testModel?(modelId: string): Promise<{
    working: boolean;
    latencyMs: number;
    ttftMs: number;
    output: string;
  }>;
  cancel?(requestId: string): Promise<void>;
}

export { ProviderError } from "./errors";
