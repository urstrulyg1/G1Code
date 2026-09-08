import type { ChatChunk, ToolCall, Usage } from "./types";
import { ProviderError } from "./errors";

export type StreamingProviderPayload = {
  choices?: Array<{
    index?: number;
    delta?: {
      content?: string;
      role?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  id?: string;
  model?: string;
};

export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  onFirstToken?: () => void,
): AsyncIterable<ChatChunk> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf8");
  let buffer = "";
  let firstTokenReported = false;
  const toolCallsAcc = new Map<
    number,
    { id: string; name: string; rawArgs: string }
  >();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;

        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          yield {
            done: true,
            toolCalls: finalizeToolCalls(toolCallsAcc),
          };
          return;
        }

        let parsed: StreamingProviderPayload;
        try {
          parsed = JSON.parse(payload) as StreamingProviderPayload;
        } catch {
          // Incomplete or non-JSON SSE chunk, skip
          continue;
        }

        const choice = parsed.choices?.[0];
        const delta = choice?.delta;

        if (delta?.content && !firstTokenReported) {
          firstTokenReported = true;
          onFirstToken?.();
        }

        // Accumulate tool calls
        if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const index = tc.index ?? 0;
            const existing = toolCallsAcc.get(index) ?? {
              id: tc.id || `call_${index}`,
              name: tc.function?.name || "",
              rawArgs: "",
            };

            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments)
              existing.rawArgs += tc.function.arguments;

            toolCallsAcc.set(index, existing);
          }
        }

        const usage: Usage | undefined = parsed.usage
          ? {
              inputTokens: parsed.usage.prompt_tokens,
              outputTokens: parsed.usage.completion_tokens,
              totalTokens: parsed.usage.total_tokens,
            }
          : undefined;

        const currentToolCalls =
          toolCallsAcc.size > 0 ? finalizeToolCalls(toolCallsAcc) : undefined;

        yield {
          content: delta?.content,
          toolCalls: currentToolCalls,
          usage,
        };
      }
    }

    // Flush any remaining tool calls
    yield {
      done: true,
      toolCalls: finalizeToolCalls(toolCallsAcc),
    };
  } finally {
    reader.releaseLock();
  }
}

function finalizeToolCalls(
  acc: Map<number, { id: string; name: string; rawArgs: string }>,
): ToolCall[] {
  const result: ToolCall[] = [];
  for (const item of acc.values()) {
    let parsedArgs: Record<string, unknown> = {};
    if (item.rawArgs) {
      try {
        parsedArgs = JSON.parse(item.rawArgs) as Record<string, unknown>;
      } catch {
        // If JSON is malformed, pass raw fallback
        parsedArgs = { raw: item.rawArgs };
      }
    }
    result.push({
      id: item.id,
      name: item.name,
      arguments: parsedArgs,
    });
  }
  return result;
}
