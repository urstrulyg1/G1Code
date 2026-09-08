import type {
  AIModel,
  ChatChunk,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ToolDefinition,
} from "./types";
import {
  AuthenticationError,
  CapabilityError,
  NetworkError,
  ProviderError,
  RateLimitError,
} from "./errors";
import {
  globalModelCatalog,
  parseModelMetadata,
  ARENA_MODELS,
  type ModelMetadata,
} from "./models";
import { parseSSEStream } from "./streaming";
import type { AIProvider } from "./provider";

export const ARENA_DEFAULT_ENDPOINT = "https://api.arena.ai/v1";

export class ArenaAIProvider implements AIProvider {
  public readonly id = "arena.ai";
  public readonly name = "Arena.ai";

  constructor(
    private readonly endpoint = ARENA_DEFAULT_ENDPOINT,
    private readonly apiKey: string,
  ) {}

  private cleanUrl(path: string): string {
    const base = (this.endpoint || ARENA_DEFAULT_ENDPOINT).replace(
      /\/+$/,
      "",
    );
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "G1Code-AI-IDE/1.0",
    };
  }

  private async requestWithRetry(
    path: string,
    options: RequestInit,
    signal?: AbortSignal,
    maxRetries = 3,
  ): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      let res: Response;
      try {
        res = await fetch(this.cleanUrl(path), {
          ...options,
          signal,
          headers: {
            ...this.headers(),
            ...(options.headers || {}),
          },
        });
      } catch (err) {
        lastError = err;
        if (signal?.aborted) {
          throw new ProviderError(
            "Request was cancelled",
            undefined,
            false,
            "cancelled",
          );
        }
        if (attempt === maxRetries - 1) {
          throw new NetworkError(
            err instanceof Error ? err.message : String(err),
          );
        }
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }

      if (res.ok) {
        return res;
      }

      const status = res.status;
      const errorText = await res.text().catch(() => "");

      if (status === 401) {
        throw new AuthenticationError(
          `Arena.ai authentication failed (${status}): Invalid or revoked API key.`,
        );
      }

      const isRetryable = status === 429 || status >= 500;
      if (!isRetryable || attempt === maxRetries - 1) {
        if (status === 429) {
          throw new RateLimitError(
            `Arena.ai rate limit reached (429): ${errorText.slice(0, 300)}`,
          );
        }
        throw new ProviderError(
          `Arena.ai request failed (${status}): ${errorText.slice(0, 300)}`,
          status,
          isRetryable,
        );
      }

      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }

    throw new ProviderError(
      `Arena.ai request exhausted retries: ${String(lastError)}`,
      undefined,
      true,
    );
  }

  async listModels(signal?: AbortSignal): Promise<AIModel[]> {
    return this.getModels(signal);
  }

  async getModels(signal?: AbortSignal): Promise<AIModel[]> {
    try {
      const response = await fetch(this.cleanUrl("/models"), {
        headers: this.headers(),
        signal,
      });

      if (!response.ok) {
        return globalModelCatalog.getModels("arena.ai");
      }

      const json = (await response.json()) as {
        data?: Array<Record<string, unknown>>;
        models?: Array<Record<string, unknown>>;
      };

      const rawList = json.data || json.models || [];
      const parsedModels: ModelMetadata[] = rawList.map((item) =>
        parseModelMetadata({
          id: String(item.id || item.slug || ""),
          name: typeof item.name === "string" ? item.name : undefined,
          display_name:
            typeof item.display_name === "string"
              ? item.display_name
              : undefined,
          context_window:
            typeof item.context_window === "number"
              ? item.context_window
              : undefined,
          max_output_tokens:
            typeof item.max_output_tokens === "number"
              ? item.max_output_tokens
              : undefined,
          capabilities:
            typeof item.capabilities === "object" && item.capabilities
              ? (item.capabilities as any)
              : undefined,
          pricing:
            typeof item.pricing === "object" && item.pricing
              ? (item.pricing as any)
              : undefined,
        }, "arena.ai"),
      );

      // Ensure built-in Arena models exist in list
      for (const arenaModel of ARENA_MODELS) {
        if (
          !parsedModels.some(
            (m) => m.id.toLowerCase() === arenaModel.id.toLowerCase(),
          )
        ) {
          parsedModels.unshift(arenaModel);
        }
      }

      return parsedModels;
    } catch {
      return globalModelCatalog.getModels("arena.ai");
    }
  }

  async getFreeModels(signal?: AbortSignal): Promise<AIModel[]> {
    const models = await this.getModels(signal);
    return models.filter(
      (m) =>
        m.isPromotional ||
        (m as ModelMetadata).pricingType === "free" ||
        (m as ModelMetadata).pricingType === "promotional",
    );
  }

  supportsTools(model: string): boolean {
    return globalModelCatalog.supportsTools(model);
  }

  supportsVision(model: string): boolean {
    return globalModelCatalog.supportsVision(model);
  }

  static normalizeModelSlug(modelId: string): string {
    if (!modelId) return "arena-agent-v1";
    const s = modelId.toLowerCase().trim();
    if (s === "arena-agent" || s === "arena-agent-1") return "arena-agent-v1";
    if (s === "arena-chat" || s === "arena-chat-1") return "arena-chat-v1";
    if (s === "arena-code" || s === "arena-code-1") return "arena-code-v1";
    return modelId;
  }

  private buildRequestBody(
    request: ChatRequest,
    stream = false,
  ): Record<string, unknown> {
    const targetModel = ArenaAIProvider.normalizeModelSlug(
      request.model || "arena-agent-v1",
    );
    const meta = globalModelCatalog.findModel(targetModel);
    const body: Record<string, unknown> = {
      model: targetModel,
      messages: request.messages,
      stream,
    };

    const canUseTools = meta ? meta.supportsTools : true;
    if (canUseTools && request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }

    const isReasoning =
      meta?.capabilities.reasoning ||
      targetModel.includes("reasoning") ||
      targetModel.includes("eval");
    if (request.temperature !== undefined && !isReasoning) {
      body.temperature = request.temperature;
    }

    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }

    return body;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();
    const body = this.buildRequestBody(request, false);

    const response = await this.requestWithRetry(
      "/chat/completions",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      request.signal,
    );

    const data = (await response.json()) as {
      id?: string;
      choices?: Array<{
        message?: ChatMessage;
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const message = data.choices?.[0]?.message;
    if (!message) {
      throw new ProviderError(
        "Arena.ai returned an empty completion response.",
      );
    }

    return {
      message,
      requestId: data.id,
      latencyMs: Date.now() - startTime,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
    yield* this.streamChat(request);
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatChunk> {
    const body = this.buildRequestBody(request, true);

    const response = await this.requestWithRetry(
      "/chat/completions",
      {
        method: "POST",
        headers: { Accept: "text/event-stream" },
        body: JSON.stringify(body),
      },
      request.signal,
    );

    if (!response.body) {
      throw new ProviderError(
        "Arena.ai did not return a readable response stream.",
      );
    }

    yield* parseSSEStream(response.body);
  }

  async verifyConnection(): Promise<{
    connected: boolean;
    modelCount: number;
    message: string;
  }> {
    try {
      const response = await fetch(this.cleanUrl("/models"), {
        headers: this.headers(),
      });
      if (response.status === 401) {
        return {
          connected: false,
          modelCount: 0,
          message:
            "Arena.ai authentication failed: Invalid or revoked API key.",
        };
      }
      if (!response.ok) {
        return {
          connected: false,
          modelCount: 0,
          message: `Arena.ai connection failed with HTTP status ${response.status}.`,
        };
      }
      const models = await this.getModels();
      return {
        connected: true,
        modelCount: models.length,
        message: `Arena.ai connected successfully. ${models.length} models available.`,
      };
    } catch (err) {
      return {
        connected: false,
        modelCount: 0,
        message: `Arena.ai connection error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async testModel(modelId: string): Promise<{
    working: boolean;
    latencyMs: number;
    ttftMs: number;
    output: string;
    error?: string;
  }> {
    const startTime = Date.now();
    let firstTokenTime = 0;

    try {
      const stream = this.streamChat({
        model: modelId,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        maxTokens: 10,
      });

      let fullText = "";
      for await (const chunk of stream) {
        if (chunk.content) {
          if (!firstTokenTime) firstTokenTime = Date.now();
          fullText += chunk.content;
        }
      }

      const totalLatency = Date.now() - startTime;
      const ttft = firstTokenTime ? firstTokenTime - startTime : totalLatency;

      return {
        working: true,
        latencyMs: totalLatency,
        ttftMs: ttft,
        output: fullText.trim() || "OK",
      };
    } catch (err) {
      return {
        working: false,
        latencyMs: Date.now() - startTime,
        ttftMs: 0,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
