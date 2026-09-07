import {
  AIModel,
  AIProvider,
  ChatChunk,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ProviderError,
  ToolCall,
} from "../types";

type ProviderPayload = {
  choices?: Array<{
    message?: ChatMessage;
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  id?: string;
  data?: unknown[];
};

export class OpenAICompatibleProvider implements AIProvider {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
  ) {}
  private url(path: string) {
    return `${this.endpoint.replace(/\/$/, "")}${path}`;
  }
  private async request(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(this.url(path), {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (attempt === 2)
          throw new ProviderError(
            `Provider network error: ${error instanceof Error ? error.message : String(error)}`,
            undefined,
            true,
          );
        await new Promise((resolve) =>
          setTimeout(resolve, 300 * (attempt + 1)),
        );
        continue;
      }
      if (response.ok) return response;
      const detail = await response.text().catch(() => "");
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 2)
        throw new ProviderError(
          `Provider request failed (${response.status}): ${detail.slice(0, 500)}`,
          response.status,
          retryable,
        );
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
    throw new ProviderError(
      "Provider request exhausted retries",
      undefined,
      true,
    );
  }
  async getModels(signal?: AbortSignal) {
    try {
      const response = await fetch(this.url("/models"), {
        headers: { authorization: `Bearer ${this.apiKey}` },
        signal,
      });
      if (!response.ok)
        throw new ProviderError(
          `Model discovery failed (${response.status})`,
          response.status,
        );
      const data = (await response.json()) as {
        data?: Array<{ id: string; owned_by?: string }>;
      };
      return (data.data ?? []).map((model) => ({
        id: model.id,
        name: model.id,
        supportsStreaming: true,
      }));
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        `Model discovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.request(
      "/chat/completions",
      {
        model: request.model,
        messages: request.messages,
        tools: request.tools,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: false,
      },
      request.signal,
    );
    const data = (await response.json()) as ProviderPayload;
    const message = data.choices?.[0]?.message;
    if (!message)
      throw new ProviderError("Provider returned no assistant message");
    return {
      message,
      requestId: data.id,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }
  async *streamChat(request: ChatRequest): AsyncIterable<ChatChunk> {
    const response = await this.request(
      "/chat/completions",
      {
        model: request.model,
        messages: request.messages,
        tools: request.tools,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: true,
      },
      request.signal,
    );
    if (!response.body)
      throw new ProviderError("Provider did not return a streaming body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const calls = new Map<number, ToolCall>();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const value = line.trim();
        if (!value.startsWith("data:")) continue;
        const raw = value.slice(5).trim();
        if (raw === "[DONE]") {
          yield { done: true, toolCalls: [...calls.values()] };
          return;
        }
        let data: ProviderPayload;
        try {
          data = JSON.parse(raw) as ProviderPayload;
        } catch {
          continue;
        }
        const delta = data.choices?.[0]?.delta;
        const toolCalls = delta?.tool_calls?.map((call, index) => {
          const at = call.index ?? index;
          const existing = calls.get(at) ?? {
            id: call.id ?? `tool-${at}`,
            name: call.function?.name ?? "",
            arguments: {},
          };
          if (!existing.name && call.function?.name)
            existing.name = call.function.name;
          if (call.function?.arguments)
            (existing as ToolCall & { raw: string }).raw =
              `${(existing as ToolCall & { raw?: string }).raw ?? ""}${call.function.arguments}`;
          calls.set(at, existing);
          return existing;
        });
        yield {
          content: delta?.content,
          toolCalls,
          usage: data.usage
            ? {
                inputTokens: data.usage.prompt_tokens,
                outputTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
              }
            : undefined,
        };
      }
    }
    yield {
      done: true,
      toolCalls: [...calls.values()].map((call) => {
        const raw = (call as ToolCall & { raw?: string }).raw;
        if (raw) {
          try {
            call.arguments = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            call.arguments = {};
          }
        }
        return call;
      }),
    };
  }
}
