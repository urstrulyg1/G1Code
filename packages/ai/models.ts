import type { AIModel } from "./types";

export type ModelCapability = {
  tools: boolean;
  streaming: boolean;
  vision: boolean;
  reasoning: boolean;
  maxOutputTokens?: number;
  contextWindow: number;
};

export type ModelMetadata = AIModel & {
  slug: string;
  displayName: string;
  provider?: "experiential-labs";
  contextWindowFormatted: string;
  capabilities: ModelCapability;
  pricingType: "free" | "promotional" | "credits" | "paid";
  pricingFormatted?: string;
  pricingDetails?: {
    input?: number;
    output?: number;
  };
  recommendedRole?:
    "coding" | "reasoning" | "fast" | "balanced" | "review" | "agent";
  apiRank?: number;
};

// Dynamic catalog models populated directly from ExperientialLabs.ai — no hardcoded models
export const PROMOTIONAL_MODELS: ModelMetadata[] = [];
export const STANDARD_CATALOG_MODELS: ModelMetadata[] = [];
export const ALL_DEFAULT_MODELS: ModelMetadata[] = [];

export function formatContextWindow(tokens?: number): string {
  if (!tokens || tokens <= 0) return "128K";
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }
  return `${tokens}`;
}

export function parseModelMetadata(
  raw: {
    id: string;
    name?: string;
    display_name?: string;
    context_window?: number;
    max_tokens?: number;
    max_output_tokens?: number;
    apiRank?: number;
    capabilities?: {
      tools?: boolean;
      function_calling?: boolean;
      streaming?: boolean;
      vision?: boolean;
      reasoning?: boolean;
    };
    pricing?: {
      free?: boolean;
      promotional?: boolean;
      input?: number;
      output?: number;
    };
    is_free?: boolean;
    free?: boolean;
    requires_payment?: boolean;
    provider?: "experiential-labs";
  },
  defaultProvider: "experiential-labs" = "experiential-labs",
): ModelMetadata {
  const id = raw.id;

  const contextWindow =
    raw.context_window ?? (id.includes("1m") ? 1_000_000 : 128_000);
  const supportsTools =
    raw.capabilities?.tools ??
    raw.capabilities?.function_calling ??
    (!id.includes("embedding") && !id.includes("moderation"));
  const supportsStreaming = raw.capabilities?.streaming ?? true;
  const supportsVision =
    raw.capabilities?.vision ??
    (id.includes("vision") ||
      id.includes("image") ||
      id.includes("multimodal"));
  const reasoning =
    raw.capabilities?.reasoning ??
    (id.includes("reasoning") ||
      id.includes("think") ||
      id.includes("r1") ||
      id.includes("agent"));

  const displayName = raw.display_name ?? raw.name ?? id;

  // Strict: only treat as Free when dynamically fetched pricing confirms Input = $0/M and Output = $0/M
  const hasDynamicPricing =
    raw.pricing !== undefined &&
    typeof raw.pricing.input === "number" &&
    typeof raw.pricing.output === "number";

  const isFreeZeroCost =
    hasDynamicPricing && raw.pricing!.input === 0 && raw.pricing!.output === 0;

  const pricingFormatted = isFreeZeroCost
    ? "Free ($0 input / $0 output)"
    : hasDynamicPricing
      ? `$${raw.pricing!.input}/M input · $${raw.pricing!.output}/M output`
      : "Credits";

  // Inferred recommended role for dynamic models
  let recommendedRole: ModelMetadata["recommendedRole"];
  const lower = id.toLowerCase();
  if (lower.includes("code") || lower.includes("coder")) {
    recommendedRole = "coding";
  } else if (
    reasoning ||
    lower.includes("r1") ||
    lower.includes("ultra") ||
    lower.includes("think")
  ) {
    recommendedRole = "reasoning";
  } else if (
    lower.includes("flash") ||
    lower.includes("mini") ||
    lower.includes("nano") ||
    lower.includes("lite") ||
    lower.includes("small")
  ) {
    recommendedRole = "fast";
  } else {
    recommendedRole = "balanced";
  }

  return {
    id,
    name: displayName,
    slug: id,
    displayName,
    provider: raw.provider || defaultProvider,
    contextWindow,
    contextWindowFormatted: formatContextWindow(contextWindow),
    supportsTools,
    supportsStreaming,
    supportsVision,
    isPromotional: isFreeZeroCost,
    pricingType: isFreeZeroCost ? "free" : "credits",
    pricingFormatted,
    pricingDetails: hasDynamicPricing
      ? { input: raw.pricing!.input, output: raw.pricing!.output }
      : undefined,
    description: isFreeZeroCost
      ? `Free ($0 input / $0 output) model on Experiential Labs gateway.`
      : undefined,
    recommendedRole,
    apiRank: raw.apiRank,
    capabilities: {
      tools: supportsTools,
      streaming: supportsStreaming,
      vision: supportsVision,
      reasoning,
      maxOutputTokens: raw.max_output_tokens ?? raw.max_tokens ?? 4096,
      contextWindow,
    },
  };
}

export class ModelCatalog {
  private cache: ModelMetadata[] = [];
  private lastFetched = 0;
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes cache

  getModels(provider?: string): ModelMetadata[] {
    const list = this.cache;
    if (!provider || provider === "all") return list;
    return list.filter(
      (m) =>
        m.provider === provider ||
        (!m.provider && provider === "experiential-labs"),
    );
  }

  getFreeModels(provider?: string): ModelMetadata[] {
    return this.getModels(provider)
      .filter(
        (m) =>
          m.pricingType === "free" &&
          m.pricingDetails?.input === 0 &&
          m.pricingDetails?.output === 0,
      )
      .sort((a, b) => (a.apiRank ?? Infinity) - (b.apiRank ?? Infinity));
  }

  getNextBestFreeModel(
    currentModelId?: string,
    restrictedModelIds?: Set<string>,
  ): ModelMetadata | undefined {
    const free = this.getFreeModels();
    return (
      free.find(
        (m) =>
          m.id !== currentModelId &&
          (!restrictedModelIds || !restrictedModelIds.has(m.id)),
      ) ||
      free.find((m) => !restrictedModelIds || !restrictedModelIds.has(m.id))
    );
  }

  getExperientialModels(): ModelMetadata[] {
    return this.getModels("experiential-labs");
  }

  isFresh(): boolean {
    return this.cache.length > 0 && Date.now() - this.lastFetched < this.TTL_MS;
  }

  setModels(models: ModelMetadata[]) {
    this.cache = models;
    this.lastFetched = Date.now();
  }

  /**
   * Updates catalog with live fetched models.
   * Auto-publishes newly available models and prunes expired/unavailable ones.
   * When isFullCatalog=true, models absent from the live response are removed.
   */
  updateCatalog(
    liveModels: ModelMetadata[],
    isFullCatalog = false,
  ): { added: string[]; removed: string[]; total: number } {
    // Start only from what's currently cached — no hardcoded fallback lists
    const existingMap = new Map<string, ModelMetadata>(
      this.cache.map((m) => [m.id.toLowerCase(), m]),
    );
    const added: string[] = [];
    const liveIds = new Set<string>();

    for (const model of liveModels) {
      const key = model.id.toLowerCase();
      liveIds.add(key);
      if (!existingMap.has(key)) {
        added.push(model.id);
      }
      // Always overwrite with the freshest data from the live API
      existingMap.set(key, model);
    }

    const removed: string[] = [];
    if (isFullCatalog && liveModels.length > 0) {
      // Prune models that are no longer reported by the live catalog
      for (const [key, existing] of existingMap.entries()) {
        if (!liveIds.has(key)) {
          existingMap.delete(key);
          removed.push(existing.id);
        }
      }
    }

    const updated = Array.from(existingMap.values());
    this.setModels(updated);

    return {
      added,
      removed,
      total: updated.length,
    };
  }

  removeModel(modelId: string): boolean {
    const key = modelId.toLowerCase();
    const beforeLen = this.cache.length;
    this.cache = this.cache.filter((m) => m.id.toLowerCase() !== key);
    return this.cache.length < beforeLen;
  }

  findModel(id: string, provider?: string): ModelMetadata | undefined {
    const cleanTarget = id.toLowerCase().replace(/[^a-z0-9]/g, "");
    const list = provider ? this.getModels(provider) : this.cache;
    return list.find((m) => {
      const mId = m.id.toLowerCase();
      const mSlug = m.slug.toLowerCase();
      return (
        mId === id.toLowerCase() ||
        mSlug === id.toLowerCase() ||
        mId.replace(/[^a-z0-9]/g, "") === cleanTarget
      );
    });
  }

  supportsTools(id: string): boolean {
    const meta = this.findModel(id);
    return meta ? (meta.supportsTools ?? true) : true;
  }

  supportsVision(id: string): boolean {
    const meta = this.findModel(id);
    return meta ? (meta.supportsVision ?? false) : false;
  }
}

export const globalModelCatalog = new ModelCatalog();
