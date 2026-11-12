import { workflowHTTPRequest } from "../lib/wailsBackend";
import type { ModelProviderProfile } from "./settings";
import { compatibleProvider, isEmbeddingModel, isOpenAIChatModel } from "./providerPresets";

function modelURL(profile: ModelProviderProfile): string {
  const base = profile.endpoint.replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/messages$/i, "");
  if (profile.provider === "gemini") {
    return `${base}/models`;
  }
  if (profile.local || compatibleProvider(profile)) return `${base}/models`;
  return base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
}

function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username || "opencode"}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function openCodeModels(payload: unknown): string[] {
  const value = payload as {
    providers?: unknown[];
    data?: unknown[];
  };
  const providers = Array.isArray(payload)
    ? payload
    : value.providers ?? value.data ?? [];
  const models: string[] = [];
  for (const raw of providers) {
    const provider = raw as {
      id?: string;
      providerID?: string;
      name?: string;
      models?: Record<string, string | { id?: string; modelID?: string; name?: string }> |
        Array<string | { id?: string; modelID?: string; name?: string }>;
    };
    const providerID = provider.providerID || provider.id || provider.name || "";
    if (!providerID || providerID.includes("/") || !provider.models) continue;
    const entries = Array.isArray(provider.models)
      ? provider.models.map((item) => ["", item] as const)
      : Object.entries(provider.models);
    for (const [key, item] of entries) {
      const modelID = typeof item === "string"
        ? (key || item)
        : item.modelID || item.id || item.name || key;
      if (modelID) models.push(`${providerID}/${modelID}`);
    }
  }
  return models;
}

export async function fetchProviderModels(
  profile: ModelProviderProfile,
): Promise<string[]> {
  const headers: Record<string, string> = {};
  const preset = compatibleProvider(profile);
  if (!profile.local && !profile.apiKey.trim()) throw new Error("Enter an API key before verifying models.");
  if (preset === "openrouter") headers["X-Title"] = "kiokuflow-desktop";
  if (preset === "opencodego") headers["User-Agent"] = "kiokuflow-desktop/1.0";
  if (profile.apiKey) {
    if (profile.provider === "gemini") {
      headers["x-goog-api-key"] = profile.apiKey;
    } else {
      headers.Authorization = `Bearer ${profile.apiKey}`;
    }
  }
  if (
    profile.local && profile.localFramework === "opencode" &&
    !profile.apiKey && (profile.username || profile.password)
  ) {
    headers.Authorization = basicAuth(profile.username, profile.password);
  }
  if (profile.provider === "anthropic" && profile.apiKey) {
    delete headers.Authorization;
    headers["x-api-key"] = profile.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  }
  if (profile.local && profile.localFramework === "opencode") {
    const base = profile.endpoint.replace(/\/+$/, "");
    let lastStatus = 0;
    let lastBody = "";
    for (const path of ["/config/providers", "/provider"]) {
      const response = await workflowHTTPRequest({
        url: `${base}${path}`,
        method: "GET",
        headers,
      });
      lastStatus = response.status;
      lastBody = response.body;
      if (response.status < 200 || response.status >= 300) continue;
      const models = openCodeModels(JSON.parse(response.body));
      if (models.length) {
        return [...new Set(models.filter(model => !isEmbeddingModel(model)))].sort((a, b) => a.localeCompare(b));
      }
    }
    throw new Error(
      `OpenCode model request failed (${lastStatus}): ${lastBody.slice(0, 240)}`,
    );
  }
  let response = await workflowHTTPRequest({
    url: modelURL(profile),
    method: "GET",
    headers,
  });
  if ((response.status < 200 || response.status >= 300) && profile.local) {
    const ollamaBase = profile.endpoint.replace(/\/+$/, "").replace(
      /\/v1$/i,
      "",
    );
    response = await workflowHTTPRequest({
      url: `${ollamaBase}/api/tags`,
      method: "GET",
      headers,
    });
    if (response.status >= 200 && response.status < 300) {
      const ollama = JSON.parse(response.body) as {
        models?: Array<{ name?: string }>;
      };
      return [
        ...new Set(
          (ollama.models ?? []).map((item) => item.name || "").filter(model => model && !isEmbeddingModel(model)),
        ),
      ].sort((a, b) => a.localeCompare(b));
    }
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Model request failed (${response.status}): ${
        response.body.slice(0, 240)
      }`,
    );
  }
  const payload = JSON.parse(response.body) as {
    data?: Array<{ id?: string; shutdown_date?: string; architecture?: { output_modalities?: string[] } }>;
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };
  if (preset) {
    // Public catalogues do not prove that the supplied key is valid.
    const base = profile.endpoint.replace(/\/+$/, "");
    const first = payload.data?.find(item => typeof item.id === "string");
    if (!first) throw new Error("The provider returned no chat models.");
    const verification = await workflowHTTPRequest({
      url: `${base}${preset === "openrouter" ? "/key" : "/chat/completions"}`,
      method: preset === "openrouter" ? "GET" : "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      ...(preset === "opencodego" ? { body: JSON.stringify({ model: first.id, messages: [] }) } : {}),
    });
    if (!(verification.status >= 200 && verification.status < 300) &&
      !(preset === "opencodego" && [400, 422].includes(verification.status))) {
      throw new Error(`Provider key verification failed (HTTP ${verification.status}).`);
    }
  }
  const officialOpenAI = profile.provider === "openai" && !profile.openAICompatible && !profile.local;
  const models = profile.provider === "gemini"
    ? (payload.models ?? []).filter(item => !item.supportedGenerationMethods || item.supportedGenerationMethods.includes("generateContent")).map((item) =>
      item.name?.replace(/^models\//, "") || ""
    )
    : (payload.data ?? []).filter(item =>
      typeof item.id === "string" &&
      (!officialOpenAI || (isOpenAIChatModel(item.id) && !(item.shutdown_date && Date.parse(item.shutdown_date) <= Date.now()))) &&
      (!preset || !item.architecture?.output_modalities || item.architecture.output_modalities.includes("text"))
    ).map((item) => item.id || "");
  return [...new Set(models.filter(model => model && !isEmbeddingModel(model)))].sort((a, b) =>
    a.localeCompare(b)
  );
}
