import { useEffect, useId, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { RAGSetting } from "../lib/wailsBackend";
import { fetchProviderModelCatalog } from "./modelProviders";
import {
  newModelProfile,
  providerDefaults,
  ragEmbeddingProfile,
  resolveRAGSetting,
  type ChatSettings,
  type ModelProviderProfile,
} from "./settings";

export function embeddingModelConnection(settings: ChatSettings, rag: RAGSetting): ModelProviderProfile | null {
  if (rag.embeddingProvider === "vertex") return null;
  if (rag.embeddingSource === "ai") {
    const profile = ragEmbeddingProfile(settings, rag.embeddingProvider) ?? settings.modelProfiles.find(candidate =>
      candidate.provider === rag.embeddingProvider && candidate.enabled &&
      (rag.embeddingProvider === "openai" || (!candidate.local && !candidate.openAICompatible))
    );
    if (profile) return profile;
  }
  const resolved = resolveRAGSetting(settings, rag);
  const gemini = rag.embeddingProvider === "gemini";
  return {
    ...newModelProfile(gemini ? "gemini" : "openai", !gemini, !gemini),
    id: rag.embeddingSource === "custom" ? "custom-embedding" : `legacy-${rag.embeddingProvider}`,
    name: rag.embeddingSource === "custom" ? "Custom embedding API" : gemini ? "Google Gemini" : "OpenAI",
    endpoint: gemini ? providerDefaults("gemini").endpoint : resolved.embeddingBaseUrl,
    apiKey: resolved.embeddingApiKey,
    local: !gemini && rag.embeddingSource === "custom",
  };
}

export function EmbeddingModelSelect({ settings, rag, onChange, onModelsDiscovered }: {
  settings: ChatSettings;
  rag: RAGSetting;
  onChange: (model: string) => void;
  onModelsDiscovered: (connection: ModelProviderProfile, models: string[]) => void;
}) {
  const id = useId();
  const connection = embeddingModelConnection(settings, rag);
  const connectionKey = JSON.stringify([
    rag.embeddingProvider, rag.embeddingSource, connection?.id, connection?.provider,
    connection?.endpoint, connection?.apiKey, connection?.local,
    connection?.localFramework, connection?.username, connection?.password,
  ]);
  const cachedModels = rag.embeddingProvider === "vertex" ? ["gemini-embedding-2"] : connection?.embeddingModels ?? [];
  const cacheKey = JSON.stringify(cachedModels);
  const [catalog, setCatalog] = useState<{ key: string; models: string[] } | null>(null);
  const [feedback, setFeedback] = useState<{ key: string; busy: boolean; error: string } | null>(null);
  const [custom, setCustom] = useState(false);
  const request = useRef(0);
  const latestKey = useRef(connectionKey);
  latestKey.current = connectionKey;
  const latestOnModels = useRef(onModelsDiscovered);
  latestOnModels.current = onModelsDiscovered;
  const models = [...new Set(catalog?.key === connectionKey ? catalog.models : cachedModels)].sort();
  const busy = feedback?.key === connectionKey && feedback.busy;
  const error = feedback?.key === connectionKey ? feedback.error : "";
  const defaultModel = rag.embeddingProvider === "vertex" ? "gemini-embedding-2"
    : rag.embeddingProvider === "gemini" ? "gemini-embedding-2-preview" : "";

  const load = async (refresh = false) => {
    const token = ++request.current;
    setFeedback({ key: connectionKey, busy: false, error: "" });
    if ((!refresh && cachedModels.length) || rag.embeddingProvider === "vertex") {
      setCatalog({ key: connectionKey, models: cachedModels });
      return;
    }
    if (!connection?.endpoint) return;
    if (!connection.local && !connection.apiKey.trim()) {
      const locked = settings.encryptedCredentials?.[JSON.stringify(["modelProfiles", connection.id, "apiKey"])];
      setFeedback({ key: connectionKey, busy: false, error: locked
        ? "The saved API key is locked. Open Settings > Encryption, enter your password, then click Unlock to fetch models."
        : "Enter an API key for this connection in Settings > AI features to fetch models." });
      return;
    }
    setFeedback({ key: connectionKey, busy: true, error: "" });
    try {
      // Listing embedding models does not verify/enable any Chat models.
      const result = await fetchProviderModelCatalog(connection, false);
      if (token !== request.current || latestKey.current !== connectionKey) return;
      setCatalog({ key: connectionKey, models: result.embeddingModels });
      setFeedback({ key: connectionKey, busy: false, error: result.embeddingModels.length
        ? "" : "No embedding models were listed. Refresh the list or choose Other model to enter a model ID." });
      latestOnModels.current(connection, result.embeddingModels);
    } catch (caught) {
      if (token !== request.current || latestKey.current !== connectionKey) return;
      setFeedback({ key: connectionKey, busy: false, error: caught instanceof Error ? caught.message : String(caught) });
    }
  };

  useEffect(() => {
    void load();
    return () => { request.current++; };
  }, [connectionKey, cacheKey]);
  useEffect(() => { setCustom(false); }, [connectionKey]);

  return (
    <div className="settings-field embedding-model-field">
      <label htmlFor={id}><span>Embedding model</span></label>
      <div className="embedding-model-controls">
        <select
          id={id}
          className="settings-select"
          value={custom ? "__custom__" : rag.embeddingModel}
          aria-describedby={`${id}-hint`}
          onChange={event => {
            if (event.target.value === "__custom__") setCustom(true);
            else { setCustom(false); onChange(event.target.value); }
          }}
        >
          <option value="">{defaultModel ? `Default (${defaultModel})` : "Select an embedding model"}</option>
          {rag.embeddingModel && !models.includes(rag.embeddingModel) && (
            <option value={rag.embeddingModel}>{rag.embeddingModel} (saved)</option>
          )}
          {models.map(model => <option key={model} value={model}>{model}</option>)}
          <option value="__custom__">Other model…</option>
        </select>
        {rag.embeddingProvider !== "vertex" && (
          <button type="button" className="settings-choice" disabled={busy || !connection?.endpoint} onClick={() => void load(true)} title="Refresh embedding models" aria-label="Refresh embedding models">
            {busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
          </button>
        )}
      </div>
      {custom && <input aria-label="Custom embedding model ID" value={rag.embeddingModel} placeholder="Embedding model ID" onChange={event => onChange(event.target.value)} />}
      <small id={`${id}-hint`} className="settings-hint">
        {busy ? "Fetching embedding models…" : connection ? `Models from ${connection.name}.` : "Vertex AI embedding models."}
        {" "}Embedding models are available without Chat model checkboxes.
      </small>
      {error && <small role="status" className="settings-status">{error}</small>}
    </div>
  );
}
