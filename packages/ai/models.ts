import type { AIModel } from "./types";

export type ModelCapability = {
  tools: boolean;
  streaming: boolean;
  vision: boolean;
  reasoning: boolean;
  reasoningSupported: boolean;
  reasoningLevels?: string[];
  defaultReasoning?: string;
  reasoningLabel?: string;
  structuredOutput?: boolean;
  parallelTools?: boolean;
  maxOutputTokens?: number;
  contextWindow: number;
};

export type ModelMetadata = AIModel & {
  slug: string;
  displayName: string;
  provider?: "experiential-labs";
  contextWindowFormatted: string;
  capabilities: ModelCapability;
  pricingType: "free" | "promotional" | "credits" | "paid" | "unknown";
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
  if (!tokens || tokens <= 0) return "Context unavailable";
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
    input_modalities?: string[];
    recommendedRole?:
      "coding" | "reasoning" | "fast" | "balanced" | "review" | "agent";
    recommended_role?: string;
    performance_category?: string;
    capabilities?: {
      tools?: boolean;
      function_calling?: boolean;
      streaming?: boolean;
      vision?: boolean;
      reasoning?: boolean;
      supports_tools?: boolean;
      supports_streaming?: boolean;
      supports_vision?: boolean;
      supports_reasoning?: boolean;
      supported_reasoning_efforts?: string[];
      reasoning_default_effort?: string;
      supports_structured_output?: boolean;
      supports_parallel_tool_calls?: boolean;
      reasoning_label?: string;
      [key: string]: unknown;
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
  const rawCaps = (raw.capabilities || {}) as Record<string, any>;

  const contextWindow =
    typeof raw.context_window === "number" && raw.context_window > 0
      ? raw.context_window
      : 0;

  const supportsTools = Boolean(
    rawCaps.tools ??
    rawCaps.function_calling ??
    rawCaps.supports_tools ??
    false,
  );

  const supportsStreaming = Boolean(
    rawCaps.streaming ?? rawCaps.supports_streaming ?? false,
  );

  const supportsVision = Boolean(
    rawCaps.vision ??
    rawCaps.supports_vision ??
    (Array.isArray(raw.input_modalities) &&
      raw.input_modalities.includes("image")),
  );

  // Dynamic reasoning detection & effort levels strictly from provider metadata
  const explicitEfforts: string[] = Array.isArray(
    rawCaps.supported_reasoning_efforts,
  )
    ? rawCaps.supported_reasoning_efforts
        .map((s: unknown) => String(s).toLowerCase().trim())
        .filter((s: string) => s.length > 0 && s !== "none")
    : [];

  const reasoningSupported = Boolean(
    rawCaps.supports_reasoning === true ||
    rawCaps.reasoning === true ||
    explicitEfforts.length > 0,
  );

  let reasoningLevels: string[] = [];
  if (reasoningSupported && explicitEfforts.length > 0) {
    reasoningLevels = [...explicitEfforts];
    if (
      !reasoningLevels.includes("auto") &&
      !reasoningLevels.includes("default")
    ) {
      reasoningLevels.unshift("auto");
    }
  }

  const defaultReasoning =
    (typeof rawCaps.reasoning_default_effort === "string" &&
    rawCaps.reasoning_default_effort
      ? rawCaps.reasoning_default_effort.toLowerCase()
      : undefined) ||
    (reasoningLevels.length > 0
      ? reasoningLevels.includes("auto")
        ? "auto"
        : reasoningLevels[0]
      : undefined);

  const structuredOutput = Boolean(
    rawCaps.structured_output ?? rawCaps.supports_structured_output ?? false,
  );
  const parallelTools = Boolean(
    rawCaps.parallel_tools ?? rawCaps.supports_parallel_tool_calls ?? false,
  );

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
      : "Pricing unavailable";

  const pricingType = isFreeZeroCost
    ? "free"
    : hasDynamicPricing
      ? "credits"
      : "unknown";

  // Role strictly from provider metadata or verified specialization (coding / verified reasoning capability)
  let recommendedRole =
    raw.recommendedRole ||
    (raw.recommended_role as ModelMetadata["recommendedRole"]) ||
    (raw.performance_category as ModelMetadata["recommendedRole"]);

  if (!recommendedRole) {
    const lower = id.toLowerCase();
    if (lower.includes("code") || lower.includes("coder")) {
      recommendedRole = "coding";
    } else if (reasoningSupported) {
      recommendedRole = "reasoning";
    }
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
    reasoningSupported,
    reasoningLevels,
    defaultReasoning,
    reasoningLabel: rawCaps.reasoning_label || "Reasoning",
    isPromotional: isFreeZeroCost,
    pricingType,
    pricingFormatted,
    pricingDetails: hasDynamicPricing
      ? { input: raw.pricing!.input, output: raw.pricing!.output }
      : undefined,
    description: isFreeZeroCost
      ? `Free ($0 input / $0 output) tier model.`
      : undefined,
    recommendedRole,
    apiRank: raw.apiRank,
    capabilities: {
      tools: supportsTools,
      streaming: supportsStreaming,
      vision: supportsVision,
      reasoning: reasoningSupported,
      reasoningSupported,
      reasoningLevels,
      defaultReasoning,
      reasoningLabel: rawCaps.reasoning_label || "Reasoning",
      structuredOutput,
      parallelTools,
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
    if (!meta) return true;
    return Boolean(meta.supportsTools ?? meta.capabilities?.tools ?? true);
  }

  supportsVision(id: string): boolean {
    const meta = this.findModel(id);
    return meta ? (meta.supportsVision ?? false) : false;
  }
}

export const globalModelCatalog = new ModelCatalog();
