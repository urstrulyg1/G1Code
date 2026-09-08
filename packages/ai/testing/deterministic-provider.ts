import type { AIModel, AIProvider, ChatChunk, ChatRequest, ChatResponse, ToolCall } from "../types";

export type DeterministicStep = { content?: string; toolCall?: ToolCall };
export class DeterministicProvider implements AIProvider {
  private index = 0;
  constructor(private readonly steps: DeterministicStep[]) {}
  async getModels(): Promise<AIModel[]> {
    return [{ id: "deterministic", name: "Deterministic Test Provider", supportsTools: true, supportsStreaming: true }];
  }
  async chat(_request: ChatRequest): Promise<ChatResponse> {
    const step = this.steps[Math.min(this.index++, this.steps.length - 1)];
    return { message: { role: "assistant", content: step?.content ?? "", toolCalls: step?.toolCall ? [step.toolCall] : [] } };
  }
  async *streamChat(_request: ChatRequest): AsyncIterable<ChatChunk> {
    const step = this.steps[Math.min(this.index++, this.steps.length - 1)];
    if (step?.content) yield { content: step.content };
    if (step?.toolCall) yield { toolCalls: [step.toolCall] };
  }
}
