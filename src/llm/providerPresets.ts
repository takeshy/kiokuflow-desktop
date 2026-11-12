import type { ModelProviderProfile } from "./settings";

export const compatibleProviderPresets = {
  openrouter: { name: "OpenRouter", endpoint: "https://openrouter.ai/api/v1" },
  opencodego: { name: "OpenCode Go", endpoint: "https://opencode.ai/zen/go/v1" },
} as const;

export function compatibleProvider(profile: Pick<ModelProviderProfile, "provider" | "endpoint" | "local">): keyof typeof compatibleProviderPresets | null {
  if (profile.provider !== "openai" || profile.local) return null;
  const endpoint = profile.endpoint.replace(/\/+$/, "");
  return (Object.keys(compatibleProviderPresets) as Array<keyof typeof compatibleProviderPresets>)
    .find(key => endpoint === compatibleProviderPresets[key].endpoint) ?? null;
}

// Match the Web app's catalogue policy; specialized models cannot run Chat.
export function isOpenAIChatModel(model: string): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model)) return false;
  const base = model.startsWith("ft:") ? model.slice(3).split(":")[0] : model;
  return /^(?:gpt-(?:[5-9]|4\.1|4o)|o[1-9]|chatgpt-)/i.test(base)
    && !/(?:audio|realtime|live|transcribe|tts|image|embedding|search-preview|deep-research)/i.test(base);
}

export function isEmbeddingModel(model: string): boolean {
  const id = model.split("/").at(-1) ?? model;
  return /(?:^|[-_])embed(?:ding)?s?(?:[-_:]|$)/i.test(id) ||
    /^(?:bge|gte|e5|multilingual-e5|all-minilm)(?:[-_:]|$)/i.test(id);
}

export function isProfileEmbeddingModel(profile: Pick<ModelProviderProfile, "embeddingModels">, model: string): boolean {
  return isEmbeddingModel(model) || profile.embeddingModels?.includes(model) === true;
}
