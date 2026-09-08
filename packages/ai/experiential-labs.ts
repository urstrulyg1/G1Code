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
    private apiKey?: string,
  ) {
    if (!this.apiKey) {
      this.apiKey =
        process.env.EXPLABS_API_KEY ||
        process.env.EXPERIENTIAL_LABS_API_KEY ||
        process.env.XPL_API_KEY ||
        "";
    }
  }

  private cleanUrl(path: string): string {
    const base = (this.endpoint || EXPERIENTIAL_LABS_DEFAULT_ENDPOINT).replace(
      /\/+$/,
      "",
    );
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }

  private headers(): Record<string, string> {
    const activeKey =
      this.apiKey ||
      process.env.EXPLABS_API_KEY ||
      process.env.EXPERIENTIAL_LABS_API_KEY ||
      process.env.XPL_API_KEY ||
      "";
    return {
      Authorization: `Bearer ${activeKey}`,
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

  // Cache for public catalog metadata to enrich gateway models with pricing and capabilities
  private static publicCatalogCache: {
    timestamp: number;
    data: Map<string, Record<string, unknown>>;
  } | null = null;

  private async fetchPublicCatalogMetadata(
    signal?: AbortSignal,
  ): Promise<Map<string, Record<string, unknown>>> {
    const now = Date.now();
    if (
      ExperientialLabsProvider.publicCatalogCache &&
      now - ExperientialLabsProvider.publicCatalogCache.timestamp < 5 * 60 * 1000
    ) {
      return ExperientialLabsProvider.publicCatalogCache.data;
    }

    const metadataMap = new Map<string, Record<string, unknown>>();
    try {
      // Fetch public catalog without requiring auth key
      const catalogUrl = "https://api.experientiallabs.ai/api/models";
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(catalogUrl, {
        signal: signal || ctrl.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const json = (await res.json()) as {
          models?: Array<{
            model?: Record<string, unknown>;
            providers?: Array<Record<string, unknown>>;
          }>;
        };
        let index = 0;
        for (const item of json.models || []) {
          index++;
          const mod = item.model;
          if (!mod || typeof mod.slug !== "string") continue;
          const slug = String(mod.slug).toLowerCase();
          const activeProviders = (item.providers || []).filter(
            (p) => p.status === "active",
          );
          const zeroCostProvider = activeProviders.find(
            (p) =>
              p.input_micro_usd_per_million === 0 &&
              p.output_micro_usd_per_million === 0,
          );
          const bestProvider = zeroCostProvider || activeProviders[0];
          const inputMicro = bestProvider?.input_micro_usd_per_million;
          const outputMicro = bestProvider?.output_micro_usd_per_million;
          const isZeroCost = inputMicro === 0 && outputMicro === 0;

          metadataMap.set(slug, {
            ...mod,
            is_free: isZeroCost,
            input_micro: inputMicro,
            output_micro: outputMicro,
            providers: item.providers,
            api_rank:
              typeof mod.preferred_rank === "number"
                ? mod.preferred_rank
                : index,
          });
        }
        ExperientialLabsProvider.publicCatalogCache = {
          timestamp: now,
          data: metadataMap,
        };
      }
    } catch {
      // Gracefully continue without external public catalog metadata
    }

    return metadataMap;
  }

  async listModels(signal?: AbortSignal): Promise<AIModel[]> {
    return this.getModels(signal);
  }

  /**
   * Dynamically fetches models from ExperientialLabs.ai, enriches them with capability
   * & pricing metadata, auto-publishes newly available models, and removes expired/unavailable ones.
   */
  async fetchDynamicCatalog(options?: {
    pruneExpired?: boolean;
    signal?: AbortSignal;
  }): Promise<{
    models: ModelMetadata[];
    freeModels: ModelMetadata[];
    added: string[];
    removed: string[];
  }> {
    try {
      const [response, publicMeta] = await Promise.all([
        fetch(this.cleanUrl("/models"), {
          headers: this.headers(),
          signal: options?.signal,
        }),
        this.fetchPublicCatalogMetadata(options?.signal),
      ]);

      if (!response.ok) {
        const fallback = globalModelCatalog.getModels();
        const fallbackFree = globalModelCatalog.getFreeModels();
        return {
          models: fallback,
          freeModels: fallbackFree,
          added: [],
          removed: [],
        };
      }

      const json = (await response.json()) as {
        data?: Array<Record<string, unknown>>;
        models?: Array<Record<string, unknown>>;
      };

      const rawList = json.data || json.models || [];
      const parsedModels: ModelMetadata[] = rawList.map((item, index) => {
        const id = String(item.id || item.slug || "");
        const slug = id.toLowerCase();
        const enriched = publicMeta.get(slug);

        const itemPricing = item.pricing as
          | { input?: number; output?: number; free?: boolean }
          | undefined;
        const enrichedInput =
          enriched?.input_micro !== undefined && enriched.input_micro !== null
            ? Number(enriched.input_micro) / 1_000_000
            : undefined;
        const enrichedOutput =
          enriched?.output_micro !== undefined && enriched.output_micro !== null
            ? Number(enriched.output_micro) / 1_000_000
            : undefined;

        const inputCost = itemPricing?.input ?? enrichedInput;
        const outputCost = itemPricing?.output ?? enrichedOutput;

        const hasPricing =
          typeof inputCost === "number" && typeof outputCost === "number";
        // ONLY treat as Free when dynamically fetched pricing confirms Input = $0/M and Output = $0/M
        const isFree = hasPricing && inputCost === 0 && outputCost === 0;

        const apiRank =
          typeof enriched?.api_rank === "number"
            ? (enriched.api_rank as number)
            : typeof item.preferred_rank === "number"
              ? (item.preferred_rank as number)
              : typeof item.rank === "number"
                ? (item.rank as number)
                : typeof (item as any).apiRank === "number"
                  ? (item as any).apiRank
                  : index;

        return parseModelMetadata({
          id,
          apiRank,
          name:
            typeof item.name === "string"
              ? item.name
              : typeof enriched?.display_name === "string"
                ? (enriched.display_name as string)
                : undefined,
          display_name:
            typeof item.display_name === "string"
              ? item.display_name
              : typeof enriched?.display_name === "string"
                ? (enriched.display_name as string)
                : undefined,
          context_window:
            typeof item.context_window === "number"
              ? item.context_window
              : typeof enriched?.context_window === "number"
                ? (enriched.context_window as number)
                : undefined,
          max_output_tokens:
            typeof item.max_output_tokens === "number"
              ? item.max_output_tokens
              : typeof enriched?.max_output_tokens === "number"
                ? (enriched.max_output_tokens as number)
                : undefined,
          capabilities:
            typeof item.capabilities === "object" && item.capabilities
              ? (item.capabilities as any)
              : typeof enriched?.capabilities === "object" && enriched?.capabilities
                ? (enriched.capabilities as any)
                : undefined,
          pricing: hasPricing
            ? { input: inputCost, output: outputCost, free: isFree }
            : isFree
              ? { input: 0, output: 0, free: true }
              : undefined,
          free: isFree,
          is_free: isFree,
        });
      });

      // Update global catalog with live models, auto-publishing new models and pruning expired
      const syncResult = globalModelCatalog.updateCatalog(
        parsedModels,
        Boolean(options?.pruneExpired),
      );

      const allModels = globalModelCatalog.getModels("experiential-labs");
      const freeModels = globalModelCatalog.getFreeModels("experiential-labs");

      return {
        models: allModels,
        freeModels,
        added: syncResult.added,
        removed: syncResult.removed,
      };
    } catch {
      const fallback = globalModelCatalog.getModels("experiential-labs");
      const fallbackFree = globalModelCatalog.getFreeModels("experiential-labs");
      return {
        models: fallback,
        freeModels: fallbackFree,
        added: [],
        removed: [],
      };
    }
  }

  async getModels(signal?: AbortSignal): Promise<AIModel[]> {
    const result = await this.fetchDynamicCatalog({
      pruneExpired: false,
      signal,
    });
    return result.models;
  }

  /**
   * Dynamically returns verified free models from ExperientialLabs.ai.
   * Auto-publishes newly available free models and prunes expired/unavailable ones.
   */
  async getFreeModels(signal?: AbortSignal): Promise<AIModel[]> {
    const result = await this.fetchDynamicCatalog({
      pruneExpired: true,
      signal,
    });
    return result.freeModels;
  }

  /**
   * Explicitly verifies available free models against the ExperientialLabs gateway.
   * Identifies newly published models and removes unavailable or expired models.
   */
  async verifyFreeModels(signal?: AbortSignal): Promise<{
    connected: boolean;
    totalModels: number;
    freeModelCount: number;
    freeModels: ModelMetadata[];
    added: string[];
    removed: string[];
    message: string;
  }> {
    const result = await this.fetchDynamicCatalog({
      pruneExpired: true,
      signal,
    });
    return {
      connected: result.models.length > 0,
      totalModels: result.models.length,
      freeModelCount: result.freeModels.length,
      freeModels: result.freeModels,
      added: result.added,
      removed: result.removed,
      message: `Verified ${result.freeModels.length} free models (${result.added.length} newly added, ${result.removed.length} expired/removed).`,
    };
  }

  supportsTools(model: string): boolean {
    return globalModelCatalog.supportsTools(model);
  }

  supportsVision(model: string): boolean {
    return globalModelCatalog.supportsVision(model);
  }

  static normalizeModelSlug(modelId?: string): string {
    if (!modelId || !modelId.trim()) {
      const firstFree =
        globalModelCatalog.getFreeModels("experiential-labs")[0] ||
        globalModelCatalog.getModels("experiential-labs")[0];
      return firstFree?.id || "";
    }
    return modelId.trim();
  }

  private buildRequestBody(
    request: ChatRequest,
    stream = false,
  ): Record<string, unknown> {
    const targetModel = ExperientialLabsProvider.normalizeModelSlug(
      request.model,
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
    const isReasoning = Boolean(meta?.capabilities.reasoning);
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

  /**
   * Non-billable model verification: checks model presence and active status in the
   * gateway catalog without sending prompts, generating tokens, or consuming credits.
   */
  async testModel(modelId: string): Promise<{
    working: boolean;
    latencyMs: number;
    ttftMs: number;
    output: string;
    error?: string;
  }> {
    const startTime = Date.now();

    try {
      const models = await this.getModels();
      const target = models.find(
        (m) =>
          m.id.toLowerCase() === modelId.toLowerCase() ||
          (m as any).slug?.toLowerCase() === modelId.toLowerCase(),
      );
      const latency = Date.now() - startTime;

      if (target) {
        return {
          working: true,
          latencyMs: latency,
          ttftMs: latency,
          output: `Model ${modelId} verified active via non-billable catalog endpoint.`,
        };
      }

      return {
        working: false,
        latencyMs: latency,
        ttftMs: 0,
        output: "",
        error: `Model ${modelId} not found in active catalog.`,
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
