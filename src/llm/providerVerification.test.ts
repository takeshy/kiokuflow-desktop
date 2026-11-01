import { expect, test, vi } from "vitest";
import { fetchProviderModels } from "./modelProviders";
import { newModelProfile } from "./settings";
import { compatibleProviderPresets } from "./providerPresets";

function mockRequests(handler: (request: { url: string; method: string; headers: Record<string, string>; body?: string }) => { status?: number; body: unknown }) {
  const call = vi.fn(async request => {
    const result = handler(request);
    return { status: result.status ?? 200, body: JSON.stringify(result.body), headers: {}, bodyBase64: "" };
  });
  vi.stubGlobal("window", { go: { main: { App: { WorkflowHTTPRequest: call } } } });
  return call;
}

test("official OpenAI discovery filters specialized, retired and duplicate model IDs", async () => {
  const call = mockRequests(request => {
    expect(request.url).toBe("https://api.openai.com/v1/models");
    expect(request.headers.Authorization).toBe("Bearer test-key");
    return { body: { data: [
      { id: "gpt-6.1-sol" }, { id: "gpt-6.1-sol" }, { id: "gpt-image-2" }, { id: "gpt-realtime" },
      { id: "text-embedding-3-small" }, { id: "o3-deep-research" }, { id: "gpt-5-retired", shutdown_date: "2020-01-01" },
      { id: "ft:gpt-6.1-sol:org:custom:id" },
    ] } };
  });
  try {
    expect(await fetchProviderModels({ ...newModelProfile(), apiKey: "test-key" })).toEqual(["ft:gpt-6.1-sol:org:custom:id", "gpt-6.1-sol"]);
    expect(call).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});

test("OpenRouter public catalogue does not verify an invalid key", async () => {
  const call = mockRequests(request => request.url.endsWith("/key")
    ? { status: 401, body: { error: "invalid key" } }
    : { body: { data: [{ id: "vendor/chat" }] } });
  try {
    await expect(fetchProviderModels({ ...newModelProfile("openai", false, true), endpoint: compatibleProviderPresets.openrouter.endpoint, apiKey: "bad-key" })).rejects.toThrow("401");
    expect(call.mock.calls.map(([request]) => request.url)).toEqual(["https://openrouter.ai/api/v1/models", "https://openrouter.ai/api/v1/key"]);
  } finally { vi.unstubAllGlobals(); }
});

test("OpenCode Go keeps the full preset path and checks authentication without generating text", async () => {
  const call = mockRequests(request => request.url.endsWith("/chat/completions")
    ? { status: 400, body: { error: "messages required" } }
    : { body: { data: [{ id: "vendor/chat", architecture: { output_modalities: ["text"] } }, { id: "vendor/image", architecture: { output_modalities: ["image"] } }] } });
  try {
    expect(await fetchProviderModels({ ...newModelProfile("openai", false, true), endpoint: compatibleProviderPresets.opencodego.endpoint, apiKey: "test-key" })).toEqual(["vendor/chat"]);
    expect(call.mock.calls.map(([request]) => request.url)).toEqual(["https://opencode.ai/zen/go/v1/models", "https://opencode.ai/zen/go/v1/chat/completions"]);
    expect(JSON.parse(call.mock.calls[1][0].body)).toEqual({ model: "vendor/chat", messages: [] });
  } finally { vi.unstubAllGlobals(); }
});
