export type ContextPart = { kind: string; content: string; priority: number };
export class ContextBudgetManager {
  constructor(private readonly maxCharacters = 120_000) {}
  select(parts: ContextPart[]) {
    let remaining = this.maxCharacters;
    return [...parts]
      .sort((a, b) => b.priority - a.priority)
      .flatMap((part) => {
        if (remaining <= 0) return [];
        const content = part.content.slice(0, remaining);
        remaining -= content.length;
        return [{ ...part, content }];
      });
  }
}
