import { expect, test, vi } from "vitest";
import { assertEquals } from "../testing/assert";
import { fetchProviderModelCatalog, fetchProviderModels } from "./modelProviders.ts";
import { newModelProfile } from "./settings.ts";

test("Gemini model discovery keeps API keys out of URLs", async () => {
  const runtime = globalThis as unknown as { window?: { go?: unknown } };
  const previous = runtime.window;
  let received: { url: string; headers: Record<string, string> } | undefined;
  runtime.window = {
    go: {
      main: {
        App: {
          WorkflowHTTPRequest: (
            request: { url: string; headers: Record<string, string> },
          ) => {
            received = request;
            return Promise.resolve({
              status: 200,
              headers: {},
              body: JSON.stringify({
                models: [
                  { name: "models/gemini-test" },
                  { name: "models/gemini-embedding-2" },
                  { name: "models/gemini-embedding-2-preview", supportedGenerationMethods: ["generateContent", "embedContent"] },
                  { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
                  { name: "models/embedding-001" },
                ],
              }),
              bodyBase64: "",
            });
          },
        },
      },
    },
  };
  try {
    const models = await fetchProviderModels({
      id: "gemini",
      name: "Gemini",
      provider: "gemini",
      endpoint: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "top-secret",
      model: "",
      vertexProjectId: "",
      vertexLocation: "",
      vertexOAuthClientId: "",
      vertexOAuthClientSecret: "",
      enabledModels: [],
      availableModels: [],
      enabled: true,
      local: false,
      openAICompatible: false,
      localFramework: "ollama",
      username: "",
      password: "",
    });
    assertEquals(models, ["gemini-test"]);
    assertEquals(received?.url.includes("top-secret"), false);
    assertEquals(received?.headers["x-goog-api-key"], "top-secret");
  } finally {
    runtime.window = previous;
  }
});

test("AnythingLLM uses its OpenAI compatibility model endpoint", async () => {
  const runtime = globalThis as unknown as { window?: { go?: unknown } };
  const previous = runtime.window;
  let receivedURL = "";
  runtime.window = {
    go: { main: { App: { WorkflowHTTPRequest: (request: { url: string }) => {
      receivedURL = request.url;
      return Promise.resolve({
        status: 200,
        headers: {},
        body: JSON.stringify({ data: [{ id: "llama" }] }),
        bodyBase64: "",
      });
    } } } },
  };
  try {
    const profile = {
      ...newModelProfile("openai", true),
      endpoint: "http://127.0.0.1:3001/api/v1/openai",
      localFramework: "anythingllm" as const,
    };
    assertEquals(await fetchProviderModels(profile), ["llama"]);
    assertEquals(
      receivedURL,
      "http://127.0.0.1:3001/api/v1/openai/models",
    );
  } finally {
    runtime.window = previous;
  }
});

test("OpenCode model discovery flattens provider and model IDs", async () => {
  const runtime = globalThis as unknown as { window?: { go?: unknown } };
  const previous = runtime.window;
  runtime.window = {
    go: { main: { App: { WorkflowHTTPRequest: () => Promise.resolve({
      status: 200,
      headers: {},
      body: JSON.stringify({
        providers: [{ providerID: "ollama", models: { qwen3: { id: "qwen3" } } }],
      }),
      bodyBase64: "",
    }) } } },
  };
  try {
    const profile = {
      ...newModelProfile("openai", true),
      endpoint: "http://127.0.0.1:4096",
      localFramework: "opencode" as const,
    };
    assertEquals(await fetchProviderModels(profile), ["ollama/qwen3"]);
  } finally {
    runtime.window = previous;
  }
});

test("provider catalogues keep all embeddings separate from Chat, including metadata aliases", async () => {
  const providers = [
    { ...newModelProfile("gemini"), apiKey: "gemini-key" },
    { ...newModelProfile(), apiKey: "openai-key" },
    { ...newModelProfile("openai", false, true), endpoint: "https://compatible.test/v1", apiKey: "compatible-key" },
    { ...newModelProfile("openai", true), endpoint: "http://localhost:11434/v1" },
  ];
  for (const profile of providers) {
    const gemini = profile.provider === "gemini";
    const call = vi.fn(async () => ({
      status: 200, headers: {}, bodyBase64: "",
      body: JSON.stringify(gemini ? { models: [
        { name: "models/gemini-chat", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-embedding-2-preview", supportedGenerationMethods: ["embedContent"] },
        { name: "models/custom-encoder", supportedGenerationMethods: ["embedContent"] },
      ] } : { data: [
        { id: "gpt-6.1-sol" }, { id: "text-embedding-3-small" },
        { id: "vendor/custom-encoder", capabilities: ["embedding"] },
        { id: "vendor/nomic-embed-text:latest" }, { id: "vendor/bge-m3" },
        { id: "vendor/jina-embeddings-v3" }, { id: "vendor/qwen3-embedding-0.6b" },
      ] }),
    }));
    vi.stubGlobal("window", { go: { main: { App: { WorkflowHTTPRequest: call } } } });
    try {
      const result = await fetchProviderModelCatalog(profile, false);
      expect(result.chatModels).toEqual([gemini ? "gemini-chat" : "gpt-6.1-sol"]);
      expect(result.embeddingModels).toContain(gemini ? "gemini-embedding-2-preview" : "text-embedding-3-small");
      expect(result.embeddingModels).toContain(gemini ? "custom-encoder" : "vendor/custom-encoder");
      expect(call).toHaveBeenCalledTimes(1);
      if (!gemini) expect(result.embeddingModels).toHaveLength(6);
    } finally { vi.unstubAllGlobals(); }
  }
});

test("RAG model discovery does not probe Chat or require enabled Chat models", async () => {
  const profile = { ...newModelProfile("openai", false, true), endpoint: "https://openrouter.ai/api/v1", apiKey: "test-key", enabledModels: [] };
  const call = vi.fn(async (request: { url: string; method: string }) => {
    expect(request.url).toBe("https://openrouter.ai/api/v1/models");
    expect(request.method).toBe("GET");
    return { status: 200, headers: {}, bodyBase64: "", body: JSON.stringify({ data: [{ id: "openai/text-embedding-3-small" }] }) };
  });
  vi.stubGlobal("window", { go: { main: { App: { WorkflowHTTPRequest: call } } } });
  try {
    expect(await fetchProviderModelCatalog(profile, false)).toEqual({ chatModels: [], embeddingModels: ["openai/text-embedding-3-small"] });
    expect(call).toHaveBeenCalledTimes(1);
    expect(profile.enabledModels).toEqual([]);
  } finally { vi.unstubAllGlobals(); }
});

test("Gemini discovery includes embedding models on later catalogue pages", async () => {
  const call = vi.fn(async (request: { url: string; headers: Record<string, string> }) => {
    expect(request.headers["x-goog-api-key"]).toBe("test-key");
    expect(request.url).not.toContain("test-key");
    return { status: 200, headers: {}, bodyBase64: "", body: JSON.stringify(request.url.includes("pageToken=")
      ? { models: [{ name: "models/gemini-embedding-2-preview", supportedGenerationMethods: ["embedContent"] }] }
      : { models: [{ name: "models/gemini-chat", supportedGenerationMethods: ["generateContent"] }], nextPageToken: "next page" }) };
  });
  vi.stubGlobal("window", { go: { main: { App: { WorkflowHTTPRequest: call } } } });
  try {
    expect(await fetchProviderModelCatalog({ ...newModelProfile("gemini"), apiKey: "test-key" }, false))
      .toEqual({ chatModels: ["gemini-chat"], embeddingModels: ["gemini-embedding-2-preview"] });
    expect(call).toHaveBeenCalledTimes(2);
    expect(new URL(call.mock.calls[1][0].url).searchParams.get("pageToken")).toBe("next page");
  } finally { vi.unstubAllGlobals(); }
});
