import { createHash } from "node:crypto";
import { ContextBudgetManager, ContextPart } from "./budget";
import { wrapUntrusted } from "./trust";

export type ContextSource = ContextPart & { path?: string; hash?: string; timestamp?: string };
export type TaskMemory = {
  objective: string;
  plan: string[];
  discoveries: string[];
  changes: string[];
  tests: string[];
  failures: string[];
  nextAction?: string;
};
export class ContextIntelligence {
  private readonly sentHashes = new Map<string, string>();
  constructor(private readonly budget = new ContextBudgetManager()) {}
  assemble(parts: ContextSource[]) {
    const fresh = parts.flatMap((part) => {
      if (!part.path) return [part];
      const hash = part.hash ?? createHash("sha256").update(part.content).digest("hex");
      if (this.sentHashes.get(part.path) === hash) return [];
      this.sentHashes.set(part.path, hash);
      return [{ ...part, hash }];
    });
    return this.budget.select(fresh);
  }
  reset() { this.sentHashes.clear(); }
  untrusted(content: string, source: string): ContextSource {
    const wrapped = wrapUntrusted(content, source);
    return { kind: "untrusted", content: wrapped.content, source: wrapped.source, priority: 1 } as ContextSource;
  }
  compact(memory: TaskMemory) {
    return [
      `Objective: ${memory.objective}`,
      memory.plan.length ? `Plan:\n${memory.plan.map((step, index) => `${index + 1}. ${step}`).join("\n")}` : "",
      memory.discoveries.length ? `Discoveries:\n- ${memory.discoveries.join("\n- ")}` : "",
      memory.changes.length ? `Changes:\n- ${memory.changes.join("\n- ")}` : "",
      memory.tests.length ? `Tests:\n- ${memory.tests.join("\n- ")}` : "",
      memory.failures.length ? `Failures:\n- ${memory.failures.join("\n- ")}` : "",
      memory.nextAction ? `Next action: ${memory.nextAction}` : "",
    ].filter(Boolean).join("\n\n");
  }
}
