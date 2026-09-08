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
  PROMOTIONAL_MODELS,
  type ModelMetadata,
} from "./models";
import { parseSSEStream } from "./streaming";
import type { AIProvider } from "./provider";

export const EXPERIENTIAL_LABS_DEFAULT_ENDPOINT =
  "https://api.experientiallabs.ai/v1";

export class ExperientialLabsProvider implements AIProvider {
  public readonly id = "experiential-labs";
  public readonly name = "Experiential Labs";

  constructor(
    private readonly endpoint = EXPERIENTIAL_LABS_DEFAULT_ENDPOINT,
    private readonly apiKey: string,
  ) {}

  private cleanUrl(path: string): string {
    const base = (this.endpoint || EXPERIENTIAL_LABS_DEFAULT_ENDPOINT).replace(
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
        // Exponential backoff
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }

      if (res.ok) {
        return res;
      }

      const status = res.status;
      const errorText = await res.text().catch(() => "");

      // Handle specific HTTP status codes
      if (status === 401) {
        throw new AuthenticationError(
          `Experiential Labs authentication failed (${status}): Invalid or revoked API key.`,
        );
      }

      const isRetryable = status === 429 || status >= 500;
      if (!isRetryable || attempt === maxRetries - 1) {
        if (status === 429) {
          throw new RateLimitError(
            `Experiential Labs rate limit reached (429): ${errorText.slice(0, 300)}`,
          );
        }
        throw new ProviderError(
          `Provider request failed (${status}): ${errorText.slice(0, 300)}`,
          status,
          isRetryable,
        );
      }

      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }

    throw new ProviderError(
      `Experiential Labs request exhausted retries: ${String(lastError)}`,
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
        // If API fails or unauthenticated, fall back to known catalog models
        return globalModelCatalog.getModels();
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
        }),
      );

      // Ensure promotional models exist in list
      for (const promo of PROMOTIONAL_MODELS) {
        if (
          !parsedModels.some(
            (m) => m.id.toLowerCase() === promo.id.toLowerCase(),
          )
        ) {
          parsedModels.unshift(promo);
        }
      }

      globalModelCatalog.setModels(parsedModels);
      return parsedModels;
    } catch {
      // If offline, network issue, or unauthenticated, fallback to catalog
      return globalModelCatalog.getModels();
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
    if (!modelId) return "gpt-6-astra";
    const s = modelId.toLowerCase().trim();
    if (s === "gpt-6" || s === "gpt6") return "gpt-6-astra";
    if (s === "qwen-3.8-27b" || s === "qwen3.8-27b") return "qwen3.8-27b";
    if (s === "meta-llama-3.3-70b-instruct" || s === "llama-3.3-70b")
      return "llama-3.3-70b-instruct";
    if (s === "deepseek-r1-distill-qwen-32b") return "deepseek-r1";
    if (s === "mistral-small-3-24b") return "mistral-small-3.2-24b-instruct";
    if (s === "qwen-2.5-coder-32b") return "qwen3-coder-30b-a3b-instruct";
    return modelId;
  }

  private buildRequestBody(
    request: ChatRequest,
    stream = false,
  ): Record<string, unknown> {
    const targetModel = ExperientialLabsProvider.normalizeModelSlug(
      request.model || "gpt-6-astra",
    );
    const meta = globalModelCatalog.findModel(targetModel);
    const body: Record<string, unknown> = {
      model: targetModel,
      messages: request.messages,
      stream,
    };

    // Capability-aware parameter construction
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

    // Some reasoning models reject temperature; only send if allowed
    const isReasoning =
      meta?.capabilities.reasoning || targetModel.includes("astra");
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
        "Experiential Labs returned an empty completion response.",
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
        "Experiential Labs did not return a readable response stream.",
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
            "Experiential Labs authentication failed: Invalid or revoked API key.",
        };
      }
      if (!response.ok) {
        return {
          connected: false,
          modelCount: 0,
          message: `Experiential Labs connection failed with HTTP status ${response.status}.`,
        };
      }
      const models = await this.getModels();
      return {
        connected: true,
        modelCount: models.length,
        message: `Experiential Labs connected successfully. ${models.length} models available.`,
      };
    } catch (err) {
      return {
        connected: false,
        modelCount: 0,
        message: `Experiential Labs connection error: ${err instanceof Error ? err.message : String(err)}`,
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
