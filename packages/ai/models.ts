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
  recommendedRole?: "coding" | "reasoning" | "fast" | "balanced" | "review" | "agent";
};

// Known promotional / free catalog models available in Experiential Labs
export const PROMOTIONAL_MODELS: ModelMetadata[] = [
  {
    id: "gpt-6-astra",
    name: "GPT-6 Astra",
    slug: "gpt-6-astra",
    displayName: "GPT-6 Astra",
    contextWindow: 1_050_000,
    contextWindowFormatted: "1.05M",
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    isPromotional: true,
    pricingType: "free",
    recommendedRole: "coding",
    description:
      "Flagship frontier reasoning & computer-use coding model with 1.05M context window.",
    capabilities: {
      tools: true,
      streaming: true,
      vision: true,
      reasoning: true,
      maxOutputTokens: 131_072,
      contextWindow: 1_050_000,
    },
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    slug: "gpt-5.6-luna",
    displayName: "GPT-5.6 Luna",
    contextWindow: 1_050_000,
    contextWindowFormatted: "1.05M",
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    isPromotional: true,
    pricingType: "free",
    recommendedRole: "fast",
    description:
      "Ultra-fast efficiency model with 1.05M context, optimized for real-time agent tasks.",
    capabilities: {
      tools: true,
      streaming: true,
      vision: false,
      reasoning: true,
      maxOutputTokens: 65_536,
      contextWindow: 1_050_000,
    },
  },
  {
    id: "qwen-3.8-27b",
    name: "Qwen3.8 27B",
    slug: "qwen3.8-27b",
    displayName: "Qwen3.8 27B",
    contextWindow: 1_000_000,
    contextWindowFormatted: "1M",
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    isPromotional: true,
    pricingType: "free",
    recommendedRole: "fast",
    description:
      "Ultra-fast instruction following and agent execution with 1M context.",
    capabilities: {
      tools: true,
      streaming: true,
      vision: false,
      reasoning: true,
      maxOutputTokens: 65_536,
      contextWindow: 1_000_000,
    },
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    slug: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    contextWindow: 1_050_000,
    contextWindowFormatted: "1.05M",
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    isPromotional: true,
    pricingType: "free",
    recommendedRole: "balanced",
    description:
      "Efficient reasoning model with 1.05M context and strong code generation.",
    capabilities: {
      tools: true,
      streaming: true,
      vision: false,
      reasoning: true,
      maxOutputTokens: 65_536,
      contextWindow: 1_050_000,
    },
  },
  {
    id: "deepseek-r1-distill-qwen-32b",
    name: "DeepSeek R1 Distill Qwen 32B",
    slug: "deepseek-r1-distill-qwen-32b",
    displayName: "DeepSeek R1 Distill Qwen 32B",
    contextWindow: 128_000,
    contextWindowFormatted: "128K",
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    isPromotional: true,
    pricingType: "free",
    recommendedRole: "reasoning",
    description:
      "Distilled mathematical and logical reasoning model with verified code generation.",
    capabilities: {
      tools: true,
      streaming: true,
      vision: false,
      reasoning: true,
      maxOutputTokens: 32_768,
      contextWindow: 128_000,
    },
  },
  {
    id: "meta-llama-3.3-70b-instruct",
    name: "Llama 3.3 70B Instruct",
    slug: "meta-llama-3.3-70b-instruct",
    displayName: "Llama 3.3 70B Instruct",
    contextWindow: 128_000,
    contextWindowFormatted: "128K",
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    isPromotional: true,
    pricingType: "free",
    recommendedRole: "balanced",
    description:
      "Versatile open-weights instruction model with comprehensive tool and agent capabilities.",
    capabilities: {
      tools: true,
      streaming: true,
      vision: false,
      reasoning: false,
      maxOutputTokens: 16_384,
      contextWindow: 128_000,
    },
  },
  {
    id: "qwen-2.5-coder-32b",
    name: "Qwen 2.5 Coder 32B",
    slug: "qwen-2.5-coder-32b",
    displayName: "Qwen 2.5 Coder 32B",
    contextWindow: 128_000,
    contextWindowFormatted: "128K",
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    isPromotional: true,
    pricingType: "free",
    recommendedRole: "coding",
    description:
      "Specialized coding model fine-tuned for repository refactoring, bug fixing, and test writing.",
    capabilities: {
      tools: true,
      streaming: true,
      vision: false,
      reasoning: false,
      maxOutputTokens: 16_384,
      contextWindow: 128_000,
    },
  },
  {
    id: "mistral-small-3-24b",
    name: "Mistral Small 3 24B",
    slug: "mistral-small-3-24b",
    displayName: "Mistral Small 3 24B",
    contextWindow: 32_768,
    contextWindowFormatted: "32K",
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    isPromotional: true,
    pricingType: "free",
    recommendedRole: "fast",
    description:
      "Compact low-latency model for rapid file edits, lint checks, and inline completion.",
    capabilities: {
      tools: true,
      streaming: true,
      vision: false,
      reasoning: false,
      maxOutputTokens: 8_192,
      contextWindow: 32_768,
    },
  },
];

// Additional standard models on Experiential Labs (paid / credits)
export const STANDARD_CATALOG_MODELS: ModelMetadata[] = [
  {
    id: "claude-fable-5.1",
    name: "Claude Fable 5.1",
    slug: "claude-fable-5.1",
    displayName: "Claude Fable 5.1",
    contextWindow: 1_000_000,
    contextWindowFormatted: "1M",
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    isPromotional: false,
    pricingType: "credits",
    recommendedRole: "coding",
    description: "Next-generation Claude frontier model with 1M context window.",
    capabilities: {
      tools: true,
      streaming: true,
      vision: true,
      reasoning: true,
      maxOutputTokens: 65_536,
      contextWindow: 1_000_000,
    },
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    slug: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    contextWindow: 1_000_000,
    contextWindowFormatted: "1M",
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    isPromotional: false,
    pricingType: "credits",
    recommendedRole: "balanced",
    description: "High-speed reasoning and code synthesis model with 1M context.",
    capabilities: {
      tools: true,
      streaming: true,
      vision: true,
      reasoning: true,
      maxOutputTokens: 65_536,
      contextWindow: 1_000_000,
    },
  },
  {
    id: "claude-opus-5",
    name: "Claude Opus 5",
    slug: "claude-opus-5",
    displayName: "Claude Opus 5",
    contextWindow: 1_000_000,
    contextWindowFormatted: "1M",
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    isPromotional: false,
    pricingType: "credits",
    recommendedRole: "reasoning",
    description: "Deep architecture reasoning and comprehensive verification model.",
    capabilities: {
      tools: true,
      streaming: true,
      vision: true,
      reasoning: true,
      maxOutputTokens: 65_536,
      contextWindow: 1_000_000,
    },
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    slug: "gpt-5.6-sol",
    displayName: "GPT-5.6 Sol",
    contextWindow: 1_050_000,
    contextWindowFormatted: "1.05M",
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    isPromotional: false,
    pricingType: "credits",
    recommendedRole: "coding",
    description: "High-performance frontier model for production workflows.",
    capabilities: {
      tools: true,
      streaming: true,
      vision: true,
      reasoning: true,
      maxOutputTokens: 65_536,
      contextWindow: 1_050_000,
    },
  },
  {
    id: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    slug: "gemini-3.7-flash",
    displayName: "Gemini 3.7 Flash",
    contextWindow: 1_050_000,
    contextWindowFormatted: "1.05M",
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
    isPromotional: false,
    pricingType: "credits",
    recommendedRole: "fast",
    description: "Ultra-high-throughput multimodal reasoning model with 935 tok/s.",
    capabilities: {
      tools: true,
      streaming: true,
      vision: true,
      reasoning: true,
      maxOutputTokens: 65_536,
      contextWindow: 1_050_000,
    },
  },
  {
    id: "kimi-k3",
    name: "Kimi K3",
    slug: "kimi-k3",
    displayName: "Kimi K3",
    contextWindow: 1_050_000,
    contextWindowFormatted: "1.05M",
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    isPromotional: false,
    pricingType: "credits",
    recommendedRole: "reasoning",
    description: "Deep-thinking long-context model with 100% benchmark score.",
    capabilities: {
      tools: true,
      streaming: true,
      vision: false,
      reasoning: true,
      maxOutputTokens: 65_536,
      contextWindow: 1_050_000,
    },
  },
  {
    id: "glm-5.3-flash",
    name: "GLM-5.3 Flash",
    slug: "glm-5.3-flash",
    displayName: "GLM-5.3 Flash",
    contextWindow: 1_310_000,
    contextWindowFormatted: "1.31M",
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    isPromotional: false,
    pricingType: "credits",
    recommendedRole: "fast",
    description: "Massive 1.31M context model operating at 3,425 tokens per second.",
    capabilities: {
      tools: true,
      streaming: true,
      vision: false,
      reasoning: true,
      maxOutputTokens: 65_536,
      contextWindow: 1_310_000,
    },
  },
];

export const ALL_DEFAULT_MODELS: ModelMetadata[] = [
  ...PROMOTIONAL_MODELS,
  ...STANDARD_CATALOG_MODELS,
];

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
    capabilities?: {
      tools?: boolean;
      function_calling?: boolean;
      streaming?: boolean;
      vision?: boolean;
      reasoning?: boolean;
    };
    pricing?: { free?: boolean; promotional?: boolean; input?: number; output?: number };
    is_free?: boolean;
    free?: boolean;
    provider?: "experiential-labs";
  },
  defaultProvider: "experiential-labs" = "experiential-labs",
): ModelMetadata {
  const id = raw.id;
  const cleanId = id.toLowerCase().replace(/[^a-z0-9]/g, "");

  const known = ALL_DEFAULT_MODELS.find((m) => {
    const mId = m.id.toLowerCase();
    const mSlug = m.slug.toLowerCase();
    const cleanMId = mId.replace(/[^a-z0-9]/g, "");
    return (
      mId === id.toLowerCase() ||
      mSlug === id.toLowerCase() ||
      cleanMId === cleanId ||
      (cleanId.includes("qwen3827b") && cleanMId.includes("qwen3827b"))
    );
  });

  const contextWindow =
    raw.context_window ??
    known?.contextWindow ??
    (id.includes("1m") ? 1_000_000 : 128_000);
  const supportsTools =
    raw.capabilities?.tools ??
    raw.capabilities?.function_calling ??
    known?.supportsTools ??
    (!id.includes("embedding") && !id.includes("moderation"));
  const supportsStreaming =
    raw.capabilities?.streaming ?? known?.supportsStreaming ?? true;
  const supportsVision =
    raw.capabilities?.vision ??
    known?.supportsVision ??
    (id.includes("vision") || id.includes("gpt-4o") || id.includes("astra") || id.includes("claude"));
  const reasoning =
    raw.capabilities?.reasoning ??
    known?.capabilities.reasoning ??
    (id.includes("reasoning") ||
      id.includes("r1") ||
      id.includes("o1") ||
      id.includes("astra") ||
      id.includes("luna") ||
      id.includes("agent") ||
      id.includes("fable"));

  const displayName = raw.display_name ?? raw.name ?? known?.displayName ?? id;
  const isPromo =
    raw.pricing?.free === true ||
    raw.pricing?.promotional === true ||
    raw.free === true ||
    raw.is_free === true ||
    (raw.pricing && raw.pricing.input === 0 && raw.pricing.output === 0) ||
    Boolean(known?.isPromotional);

  return {
    id,
    name: displayName,
    slug: known?.slug || id,
    displayName,
    provider: raw.provider || known?.provider || defaultProvider,
    contextWindow,
    contextWindowFormatted: formatContextWindow(contextWindow),
    supportsTools,
    supportsStreaming,
    supportsVision,
    isPromotional: isPromo,
    pricingType: isPromo ? "free" : (known?.pricingType || "credits"),
    description: known?.description,
    capabilities: {
      tools: supportsTools,
      streaming: supportsStreaming,
      vision: supportsVision,
      reasoning,
      maxOutputTokens:
        raw.max_output_tokens ??
        raw.max_tokens ??
        known?.capabilities.maxOutputTokens ??
        4096,
      contextWindow,
    },
  };
}

export class ModelCatalog {
  private cache: ModelMetadata[] = [];
  private lastFetched = 0;
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes cache

  getModels(provider?: string): ModelMetadata[] {
    const list = this.cache.length > 0 ? this.cache : ALL_DEFAULT_MODELS;
    if (!provider || provider === "all") return list;
    return list.filter(
      (m) =>
        m.provider === provider ||
        (!m.provider && provider === "experiential-labs"),
    );
  }

  getFreeModels(provider?: string): ModelMetadata[] {
    return this.getModels(provider).filter(
      (m) =>
        m.isPromotional ||
        m.pricingType === "free" ||
        m.pricingType === "promotional",
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

  findModel(id: string, provider?: string): ModelMetadata | undefined {
    const cleanTarget = id.toLowerCase().replace(/[^a-z0-9]/g, "");
    const list = provider ? this.getModels(provider) : (this.cache.length > 0 ? this.cache : ALL_DEFAULT_MODELS);
    return list.find((m) => {
      const mId = m.id.toLowerCase();
      const mSlug = m.slug.toLowerCase();
      return (
        mId === id.toLowerCase() ||
        mSlug === id.toLowerCase() ||
        mId.replace(/[^a-z0-9]/g, "") === cleanTarget
      );
    }) ?? ALL_DEFAULT_MODELS.find((m) => {
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
