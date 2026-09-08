import type {
  AIModel,
  ChatChunk,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ToolDefinition,
} from "./types";

export interface AIProvider {
  id: string;
  name: string;

  /** Dynamic model discovery */
  listModels(signal?: AbortSignal): Promise<AIModel[]>;
  getModels(signal?: AbortSignal): Promise<AIModel[]>;
  getFreeModels?(signal?: AbortSignal): Promise<AIModel[]>;

  /** Chat completion */
  chat(request: ChatRequest): Promise<ChatResponse>;

  /** Streaming chat completion */
  stream(request: ChatRequest): AsyncIterable<ChatChunk>;
  streamChat(request: ChatRequest): AsyncIterable<ChatChunk>;

  /** Capability checks */
  supportsTools(model: string): boolean;
  supportsVision(model: string): boolean;

  /** Health & Diagnostics */
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
    error?: string;
  }>;

  /** Cancellation */
  cancel?(requestId: string): Promise<void>;
}

export * from "./types";
export {
  AuthenticationError,
  RateLimitError,
  CapabilityError,
  NetworkError,
  formatUserFriendlyError,
} from "./errors";
export * from "./models";
