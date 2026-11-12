import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EmbeddingModelSelect, embeddingModelConnection } from "./EmbeddingModelSelect";
import { defaultChatSettings, defaultRAGSetting, newModelProfile, resolveRAGSetting } from "./settings";

test("embedding dropdown follows the same native or compatible connection as RAG credentials", () => {
  const gemini = { ...newModelProfile("gemini"), id: "gemini", apiKey: "gemini-key", embeddingModels: ["gemini-embedding-2-preview"] };
  const openai = { ...newModelProfile(), id: "openai", apiKey: "openai-key", embeddingModels: ["text-embedding-3-small"] };
  const compatible = { ...newModelProfile("openai", false, true), id: "compatible", endpoint: "https://embedding.example/v1", apiKey: "compatible-key", embeddingModels: ["custom-encoder"] };
  const settings = { ...defaultChatSettings, provider: "cli" as const, selectedModelProfileId: compatible.id, modelProfiles: [gemini, openai, compatible] };
  for (const provider of ["gemini", "openai", "vertex"] as const) {
    const rag = { ...defaultRAGSetting, embeddingProvider: provider };
    const resolved = resolveRAGSetting(settings, rag);
    const connection = embeddingModelConnection(settings, rag);
    if (provider !== "vertex") {
      expect(connection?.apiKey).toBe(resolved.embeddingApiKey);
      if (provider === "openai") expect(connection?.endpoint).toBe(resolved.embeddingBaseUrl);
    }
    const html = renderToStaticMarkup(<EmbeddingModelSelect settings={settings} rag={rag} onChange={() => {}} onModelsDiscovered={() => {}} />);
    expect(html).toContain("<select");
    expect(html).toContain(provider === "gemini" ? "gemini-embedding-2-preview" : provider === "openai" ? "custom-encoder" : "gemini-embedding-2");
    expect(html).not.toContain('type="checkbox"');
    if (provider === "openai") expect(html).not.toContain("text-embedding-3-small");
  }
});

test("custom URLs use their own model catalogue while saved model IDs are preserved", () => {
  const rag = { ...defaultRAGSetting, embeddingSource: "custom" as const, embeddingProvider: "openai" as const, embeddingBaseUrl: "http://localhost:11434/v1", embeddingApiKey: "custom-key", embeddingModel: "saved-encoder" };
  const connection = embeddingModelConnection(defaultChatSettings, rag);
  expect(connection).toMatchObject({ endpoint: rag.embeddingBaseUrl, apiKey: "custom-key", provider: "openai" });
  const html = renderToStaticMarkup(<EmbeddingModelSelect settings={defaultChatSettings} rag={rag} onChange={() => {}} onModelsDiscovered={() => {}} />);
  expect(html).toContain('value="saved-encoder" selected');
  expect(html).toContain("saved-encoder (saved)");
});
