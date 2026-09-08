import assert from "node:assert/strict";
import { test } from "node:test";
import { ExperientialLabsProvider } from "../packages/ai/experiential-labs";
import {
  AuthenticationError,
  RateLimitError,
  ProviderError,
} from "../packages/ai/errors";
import {
  parseModelMetadata,
  globalModelCatalog,
  ModelCatalog,
} from "../packages/ai/models";
import {
  readApiKeyFromZshrcSync,
  getApiKey,
} from "../packages/settings/storage";

test("Experiential Labs Provider: parseModelMetadata correctly parses dynamic models with inferred roles and free pricing", () => {
  const metaFree = parseModelMetadata({
    id: "nemotron-3-ultra-550b-a55b-free",
    name: "Nemotron Ultra 550B",
    context_window: 128000,
    capabilities: { tools: true, streaming: true, reasoning: true },
    pricing: { input: 0, output: 0 },
  });
  assert.equal(metaFree.id, "nemotron-3-ultra-550b-a55b-free");
  assert.equal(metaFree.isPromotional, true);
  assert.equal(metaFree.pricingType, "free");
  assert.equal(metaFree.pricingFormatted, "Free ($0 input / $0 output)");
  assert.equal(metaFree.recommendedRole, "reasoning");
  assert.equal(metaFree.supportsTools, true);
  assert.equal(metaFree.contextWindowFormatted, "128K");

  const metaCoder = parseModelMetadata({
    id: "qwen-3-coder-free",
    display_name: "Qwen 3 Coder Free",
    context_window: 1000000,
    pricing: { input: 0, output: 0 },
  });
  assert.equal(metaCoder.isPromotional, true);
  assert.equal(metaCoder.pricingType, "free");
  assert.equal(metaCoder.pricingFormatted, "Free ($0 input / $0 output)");
  assert.equal(metaCoder.recommendedRole, "coding");
  assert.equal(metaCoder.contextWindowFormatted, "1M");

  // Models without $0 input / $0 output pricing must NOT be marked free even if their name contains "free"
  const metaNotFree = parseModelMetadata({
    id: "some-model-free",
    display_name: "Some Model Free",
    pricing: { input: 1.0, output: 2.0 },
  });
  assert.equal(metaNotFree.isPromotional, false);
  assert.equal(metaNotFree.pricingType, "credits");
  assert.equal(metaNotFree.pricingFormatted, "$1/M input · $2/M output");
});

test("Experiential Labs Provider: Dynamic model discovery populates live API models without hardcoding", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "custom-claude-3-7-sonnet",
                name: "Claude 3.7 Sonnet",
                context_window: 200000,
                pricing: { input: 3.0, output: 15.0 },
              },
              {
                id: "gemma-4-26b-a4b-it-free",
                display_name: "Gemma 4 Free",
                pricing: { input: 0, output: 0 },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_testkey",
    );
    const models = await provider.getModels();

    assert.ok(
      models.length >= 2,
      "Populated live API models dynamically",
    );
    const custom = models.find((m) => m.id === "custom-claude-3-7-sonnet");
    assert.ok(custom, "Live API model exists");
    assert.equal(custom.name, "Claude 3.7 Sonnet");

    const free = models.find((m) => m.id === "gemma-4-26b-a4b-it-free");
    assert.ok(free, "Dynamic free model exists");
    assert.equal(free.isPromotional, true);
    assert.equal(free.pricingFormatted, "Free ($0 input / $0 output)");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Experiential Labs Provider: Capability-aware request parameter filtering", async () => {
  const originalFetch = globalThis.fetch;
  let sentBody: any;
  try {
    globalThis.fetch = async (_url, options) => {
      if (options?.body) {
        sentBody = JSON.parse(String(options.body));
      }
      return new Response(
        JSON.stringify({
          id: "chat-123",
          choices: [{ message: { role: "assistant", content: "OK" } }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_testkey",
    );

    // Test 1: Model with tools
    await provider.chat({
      model: "gpt-6-astra",
      messages: [{ role: "user", content: "test" }],
      tools: [
        {
          name: "read_file",
          description: "read",
          inputSchema: { type: "object" },
        },
      ],
      temperature: 0.2,
    });

    assert.ok(sentBody.tools, "Tools should be included for gpt-6-astra");
    assert.equal(sentBody.tools[0].function.name, "read_file");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Experiential Labs Provider: Normalizes 401 Unauthorized to AuthenticationError", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("Unauthorized: invalid_key", { status: 401 });

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_invalid",
    );
    await assert.rejects(
      provider.chat({
        model: "gpt-6-astra",
        messages: [{ role: "user", content: "hi" }],
      }),
      (err) => err instanceof AuthenticationError && err.status === 401,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Experiential Labs Provider: Normalizes 429 Rate Limit to RateLimitError", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("Rate limit reached", { status: 429 });

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_valid",
    );
    await assert.rejects(
      provider.chat({
        model: "gpt-6-astra",
        messages: [{ role: "user", content: "hi" }],
      }),
      (err) =>
        err instanceof RateLimitError &&
        err.status === 429 &&
        err.retryable === true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Experiential Labs Provider: verifyConnection tests endpoint without generating tokens", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/models")) {
        return new Response(
          JSON.stringify({
            data: [{ id: "gpt-6-astra" }, { id: "qwen-3.8-27b" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error("Unexpected endpoint");
    };

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_valid",
    );
    const result = await provider.verifyConnection();
    assert.equal(result.connected, true);
    assert.ok(result.modelCount >= 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Experiential Labs Provider: verifyConnection returns connected false on 401 Unauthorized", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("Unauthorized", { status: 401 });

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_badkey",
    );
    const result = await provider.verifyConnection();
    assert.equal(result.connected, false);
    assert.equal(result.modelCount, 0);
    assert.ok(result.message.includes("authentication failed"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Experiential Labs Provider: testModel verifies model availability via non-billable catalog endpoint without consuming credits", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/models")) {
        return new Response(
          JSON.stringify({
            data: [{ id: "verified-free-model", name: "Verified Free Model" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_valid",
    );
    const result = await provider.testModel("verified-free-model");
    assert.equal(result.working, true);
    assert.ok(result.output.includes("non-billable catalog"));
    assert.ok(result.latencyMs >= 0);

    const unknown = await provider.testModel("missing-model");
    assert.equal(unknown.working, false);
    assert.ok(unknown.error?.includes("not found in active catalog"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Experiential Labs Provider: Dynamically discovers live free models and prunes expired ones", async () => {
  const originalFetch = globalThis.fetch;
  try {
    // Initial fetch returns model-a-free and model-b-free with verified $0/$0 pricing
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "model-a-free",
              name: "Model A Free",
              pricing: { input: 0, output: 0 },
            },
            {
              id: "model-b-free",
              name: "Model B Free",
              pricing: { input: 0, output: 0 },
            },
            {
              id: "model-paid",
              name: "Model Paid",
              pricing: { input: 2.0, output: 5.0 },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_valid",
    );

    const freeModels = await provider.getFreeModels();
    assert.equal(freeModels.length, 2);
    assert.ok(freeModels.some((m) => m.id === "model-a-free"));
    assert.ok(freeModels.some((m) => m.id === "model-b-free"));
    assert.equal(freeModels.some((m) => m.id === "model-paid"), false);

    // Next fetch: model-a-free has expired, and model-c-free is newly available
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "model-b-free",
              name: "Model B Free",
              pricing: { input: 0, output: 0 },
            },
            {
              id: "model-c-free",
              name: "Model C Free",
              pricing: { input: 0, output: 0 },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const verifyResult = await provider.verifyFreeModels();
    assert.equal(verifyResult.freeModelCount, 2);
    assert.ok(
      verifyResult.added.includes("model-c-free"),
      "model-c-free auto-published",
    );
    assert.ok(
      verifyResult.removed.includes("model-a-free"),
      "model-a-free pruned",
    );

    const updatedFree = await provider.getFreeModels();
    assert.equal(
      updatedFree.some((m) => m.id === "model-a-free"),
      false,
      "Expired model removed",
    );
    assert.equal(
      updatedFree.some((m) => m.id === "model-c-free"),
      true,
      "New model available",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Experiential Labs Provider: Correctly flags live API models with free pricing as promotional", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "new-experimental-free-model",
              name: "New Experimental Free Model",
              pricing: { free: true, input: 0, output: 0 },
              context_window: 256000,
            },
            {
              id: "new-paid-model",
              name: "New Paid Model",
              pricing: { free: false, input: 1.5, output: 5.0 },
              context_window: 128000,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_valid",
    );
    const freeModels = await provider.getFreeModels();
    const liveFree = freeModels.find((m) => m.id === "new-experimental-free-model");
    assert.ok(liveFree, "Dynamic live API free model should be included in free models");
    assert.equal(liveFree.isPromotional, true);

    const livePaid = freeModels.find((m) => m.id === "new-paid-model");
    assert.equal(livePaid, undefined, "Paid model must not be included in free models");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Experiential Labs Provider: Correctly reads API key from ~/.zshrc without exposing or hardcoding", async () => {
  const key = readApiKeyFromZshrcSync();
  assert.ok(key, "API key should be detected from user's ~/.zshrc");
  assert.ok(key.startsWith("xpl_"), "Key should start with xpl_ prefix");

  const resolved = await getApiKey();
  assert.equal(resolved, key, "getApiKey should resolve the key directly from ~/.zshrc");
});

test("Experiential Labs Provider: Automatically fails over to next best available free model based on API ranking", () => {
  const catalog = new ModelCatalog();
  const models = [
    parseModelMetadata({
      id: "free-model-rank-2",
      name: "Rank 2 Free Model",
      apiRank: 2,
      pricing: { input: 0, output: 0 },
    }),
    parseModelMetadata({
      id: "free-model-rank-1",
      name: "Rank 1 Top Free Model",
      apiRank: 1,
      pricing: { input: 0, output: 0 },
    }),
    parseModelMetadata({
      id: "free-model-rank-3",
      name: "Rank 3 Free Model",
      apiRank: 3,
      pricing: { input: 0, output: 0 },
    }),
    parseModelMetadata({
      id: "paid-model",
      name: "Paid Model",
      apiRank: 0,
      pricing: { input: 1.0, output: 2.0 },
    }),
  ];

  catalog.updateCatalog(models, true);

  const freeModels = catalog.getFreeModels();
  assert.equal(freeModels.length, 3, "Only $0 input / $0 output models are free");
  // Verified sorted by apiRank ascending
  assert.equal(freeModels[0].id, "free-model-rank-1");
  assert.equal(freeModels[1].id, "free-model-rank-2");
  assert.equal(freeModels[2].id, "free-model-rank-3");

  // When rank 1 becomes restricted or reaches usage limits:
  const nextBest = catalog.getNextBestFreeModel("free-model-rank-1", new Set(["free-model-rank-1"]));
  assert.equal(nextBest?.id, "free-model-rank-2", "Failover should pick next best free model");

  // When rank 1 and 2 are restricted:
  const nextBestAfter2 = catalog.getNextBestFreeModel("free-model-rank-2", new Set(["free-model-rank-1", "free-model-rank-2"]));
  assert.equal(nextBestAfter2?.id, "free-model-rank-3", "Failover should pick rank 3");
});

test("Experiential Labs Provider: Model discovery, 30s refresh, and verification use strictly non-billable endpoints without credit consumption", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  try {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      requestedUrls.push(urlStr);

      if (urlStr.includes("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "test-free-1",
                name: "Test Free 1",
                pricing: { input: 0, output: 0 },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_valid",
    );

    // 1. Dynamic free models discovery
    await provider.getFreeModels();
    // 2. All models listing
    await provider.getModels();
    // 3. Model verification
    await provider.verifyFreeModels();
    // 4. Connection verification
    await provider.verifyConnection();
    // 5. Model test (availability check)
    await provider.testModel("test-free-1");

    // Verify: zero calls to /chat/completions or any billable inference endpoint
    assert.ok(requestedUrls.length > 0, "Non-billable catalog calls were made");
    const inferenceCalls = requestedUrls.filter(
      (u) => u.includes("/chat") || u.includes("/completions"),
    );
    assert.equal(
      inferenceCalls.length,
      0,
      "No inference or credit-consuming calls may be made during model discovery, verification, or refresh",
    );

    // Verify all endpoints are strictly non-billable metadata/catalog endpoints
    for (const url of requestedUrls) {
      const isCatalog =
        url.includes("/v1/models") || url.includes("/api/models");
      assert.ok(
        isCatalog,
        `Expected non-billable catalog endpoint but got: ${url}`,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});



