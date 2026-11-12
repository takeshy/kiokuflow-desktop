import { expect, test } from "vitest";
import { rerankingCredentialIssue } from "./rerankingCredentials";
import { defaultChatSettings, defaultRAGSetting, newModelProfile } from "./settings";

test("missing Gemini keys point to AI features without claiming encryption is locked", () => {
  const issue = rerankingCredentialIssue(defaultChatSettings, defaultRAGSetting, "gemini");
  expect(issue).toMatchObject({ section: "ai", action: "Open AI features" });
  expect(issue?.message).toContain("No Gemini API key is configured");
  expect(issue?.message).not.toMatch(/unlock|locked|native|AI providers/i);
});

test("encrypted Gemini profile keys point to Encryption using stable profile IDs", () => {
  const profile = { ...newModelProfile("gemini"), id: "saved-gemini", apiKey: "", enabled: true };
  const settings = {
    ...defaultChatSettings,
    modelProfiles: [newModelProfile(), profile],
    encryptedCredentials: { [JSON.stringify(["modelProfiles", profile.id, "apiKey"])]: "encrypted-key" },
  };
  const issue = rerankingCredentialIssue(settings, defaultRAGSetting, "gemini");
  expect(issue).toMatchObject({ section: "encryption", action: "Open Encryption" });
  expect(issue?.message).toContain("enter your encryption password, then click Unlock");
  expect(rerankingCredentialIssue({ ...settings, modelProfiles: [{ ...profile, apiKey: "unlocked" }] }, defaultRAGSetting, "gemini")).toBeNull();
});

test("disabled Gemini providers are distinguished from locked or missing credentials", () => {
  const profile = { ...newModelProfile("gemini"), id: "gemini", apiKey: "", enabled: false };
  const settings = {
    ...defaultChatSettings,
    modelProfiles: [profile],
    encryptedCredentials: { [JSON.stringify(["modelProfiles", profile.id, "apiKey"])]: "encrypted-key" },
  };
  const issue = rerankingCredentialIssue(settings, defaultRAGSetting, "gemini");
  expect(issue?.section).toBe("ai");
  expect(issue?.message).toContain("provider is disabled");
});

test("custom embedding keys are checked only for the selected RAG setting", () => {
  const rag = { ...defaultRAGSetting, embeddingSource: "custom" as const };
  const settings = {
    ...defaultChatSettings,
    ragSettings: { docs: rag },
    encryptedCredentials: { [JSON.stringify(["ragSettings", "docs", "embeddingApiKey"])]: "encrypted-key" },
  };
  expect(rerankingCredentialIssue(settings, rag, "gemini", "docs")?.section).toBe("encryption");
  expect(rerankingCredentialIssue(settings, rag, "gemini", "other")?.section).toBe("ai");
  expect(rerankingCredentialIssue(settings, { ...rag, embeddingApiKey: "custom-key" }, "gemini", "docs")).toBeNull();
});

test("OpenRouter credentials cannot satisfy Gemini reranking", () => {
  const profile = { ...newModelProfile("openai", false, true), endpoint: "https://openrouter.ai/api/v1", apiKey: "router-key", enabled: true };
  const settings = { ...defaultChatSettings, modelProfiles: [profile] };
  const issue = rerankingCredentialIssue(settings, defaultRAGSetting, "gemini");
  expect(issue?.section).toBe("ai");
  expect(issue?.message).toContain("OpenRouter and Vertex AI credentials cannot be used here");
});

test("Jev guidance follows the selected direct or OpenRouter connection", () => {
  expect(rerankingCredentialIssue({ ...defaultChatSettings, jevUseOpenRouter: false }, defaultRAGSetting, "jev"))
    .toMatchObject({ section: "rag", action: "Open RAG settings" });
  expect(rerankingCredentialIssue({ ...defaultChatSettings, jevUseOpenRouter: false, encryptedCredentials: { '["jevApiKey"]': "encrypted-key" } }, defaultRAGSetting, "jev")?.section)
    .toBe("encryption");
  const profile = { ...newModelProfile("openai", false, true), id: "router", endpoint: "https://openrouter.ai/api/v1", apiKey: "", enabled: true };
  const settings = {
    ...defaultChatSettings,
    jevUseOpenRouter: true,
    jevApiKey: "direct-key",
    modelProfiles: [profile],
    encryptedCredentials: { '["modelProfiles","router","apiKey"]': "encrypted-key" },
  };
  expect(rerankingCredentialIssue(settings, defaultRAGSetting, "jev")?.section).toBe("encryption");
  expect(rerankingCredentialIssue({ ...settings, modelProfiles: [{ ...profile, apiKey: "unlocked-router-key" }] }, defaultRAGSetting, "jev")).toBeNull();
  expect(rerankingCredentialIssue(settings, defaultRAGSetting, "off")).toBeNull();
});
