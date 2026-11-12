import type { RAGRerankProvider, RAGSetting } from "../lib/wailsBackend";
import { resolveRAGSetting, type ChatSettings } from "./settings";

export type RerankingSettingsSection = "ai" | "encryption" | "rag";

interface CredentialIssue {
  message: string;
  section: RerankingSettingsSection;
  action: string;
}

export function rerankingCredentialIssue(
  settings: ChatSettings,
  rag: RAGSetting,
  provider: RAGRerankProvider,
  ragName?: string,
): CredentialIssue | null {
  if (provider === "off") return null;
  const resolved = resolveRAGSetting(settings, { ...rag, rerankProvider: provider });
  const key = provider === "gemini" ? resolved.geminiApiKey : resolved.jevApiKey;
  if (key?.trim()) return null;
  const locked = (...path: string[]) => Boolean(settings.encryptedCredentials?.[JSON.stringify(path)]);
  const lockedIssue = (name: string): CredentialIssue => ({
    message: `Your saved ${name} API key is encrypted and locked for this session. Open Settings > Encryption, enter your encryption password, then click Unlock.`,
    section: "encryption",
    action: "Open Encryption",
  });
  const disabledIssue = (name: string): CredentialIssue => ({
    message: `The ${name} provider is disabled. Open Settings > AI features, edit its provider card, and turn on Enabled.`,
    section: "ai",
    action: "Open AI features",
  });

  if (provider === "gemini") {
    const profiles = settings.modelProfiles.filter(profile =>
      profile.provider === "gemini" && !profile.local && !profile.openAICompatible
    );
    const geminiEmbedding = rag.embeddingProvider === "gemini" && !rag.embeddingBaseUrl;
    if (profiles.some(profile => profile.enabled && locked("modelProfiles", profile.id, "apiKey")) ||
      (settings.modelProfiles.length === 0 && settings.provider === "gemini" && locked("apiKey")) ||
      (geminiEmbedding && rag.embeddingSource === "custom" && ragName && locked("ragSettings", ragName, "embeddingApiKey")) ||
      (geminiEmbedding && rag.embeddingSource === "ai" && profiles.length === 0 && locked("providerProfiles", "gemini", "apiKey"))) {
      return lockedIssue("Gemini");
    }
    if (profiles.length && profiles.every(profile => !profile.enabled)) return disabledIssue("Google Gemini");
    return {
      message: "No Gemini API key is configured for reranking. Open Settings > AI features and enter an API key in a Google Gemini provider. OpenRouter and Vertex AI credentials cannot be used here.",
      section: "ai",
      action: "Open AI features",
    };
  }

  if (!resolved.jevUseOpenRouter) {
    if (locked("jevApiKey")) return lockedIssue("Jev");
    return {
      message: "No Jev API key is configured. Open Settings > RAG and enter a TypeSafe API key in the Jev section, or turn on Use the configured OpenRouter key.",
      section: "rag",
      action: "Open RAG settings",
    };
  }

  const isOpenRouter = (endpoint: string) => {
    try {
      const url = new URL(endpoint);
      return url.origin === "https://openrouter.ai" && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  };
  const profiles = settings.modelProfiles.filter(profile => isOpenRouter(profile.endpoint));
  if (profiles.some(profile => profile.enabled && locked("modelProfiles", profile.id, "apiKey")) ||
    (!profiles.length && isOpenRouter(settings.endpoint) && locked("apiKey")) ||
    (!profiles.length && isOpenRouter(settings.providerProfiles.openai?.endpoint ?? "") && locked("providerProfiles", "openai", "apiKey"))) {
    return lockedIssue("OpenRouter");
  }
  if (profiles.length && profiles.every(profile => !profile.enabled)) return disabledIssue("OpenRouter");
  return {
    message: "No OpenRouter API key is configured for Jev. Open Settings > AI features and enter an API key in an OpenRouter provider, or choose a direct Jev connection in Settings > RAG.",
    section: "ai",
    action: "Open AI features",
  };
}
