import { expect, test, vi } from "vitest";
import { configureOrUnlockHistoryEncryption } from "./historyEncryption";
import { lockSettingsCredentials } from "./settingsCredentials";
import { CHAT_SETTINGS_KEY, defaultChatSettings, loadChatSettings, newModelProfile, saveChatSettings, selectModelProfile, unlockChatSettings, updateModelProfile } from "../llm/settings";

test("API credentials migrate to the common public key, survive locked saves and unlock together", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal("window", new EventTarget());
  try {
    const first = { ...newModelProfile(), id: "first", apiKey: "first-secret", model: "gpt-6.1-sol", enabledModels: ["gpt-6.1-sol"] };
    const second = { ...newModelProfile("gemini"), id: "second", apiKey: "second-secret" };
    const settings = selectModelProfile({ ...defaultChatSettings, modelProfiles: [first, second], jevApiKey: "jev-secret", speech: { ...defaultChatSettings.speech, apiKey: "speech-secret" } }, first.id);
    await saveChatSettings(settings);
    values.set("llm-hub:chat-settings", JSON.stringify(settings));
    await configureOrUnlockHistoryEncryption("common-password");
    await saveChatSettings(settings);
    const stored = values.get(CHAT_SETTINGS_KEY)!;
    for (const secret of ["first-secret", "second-secret", "jev-secret", "speech-secret", "common-password"]) expect(stored).not.toContain(secret);
    expect(values.has("llm-hub:chat-settings")).toBe(false);
    expect(loadChatSettings().apiKey).toBe("first-secret");

    // Simulate a cold session. Unrelated edits must retain the locked keys.
    lockSettingsCredentials();
    expect(loadChatSettings().apiKey).toBe("");
    expect(loadChatSettings().jevApiKey).toBe("");
    const locked = loadChatSettings();
    await saveChatSettings({ ...locked, systemPrompt: "updated while locked" });
    await expect(configureOrUnlockHistoryEncryption("wrong-password")).rejects.toThrow("incorrect");
    await configureOrUnlockHistoryEncryption("common-password");
    let unlocked = await unlockChatSettings();
    expect(unlocked.apiKey).toBe("first-secret");
    expect(unlocked.jevApiKey).toBe("jev-secret");
    expect(unlocked.speech.apiKey).toBe("speech-secret");
    expect(unlocked.systemPrompt).toBe("updated while locked");

    // A locked public-key save can accept a new key without losing other keys.
    lockSettingsCredentials();
    await saveChatSettings({ ...loadChatSettings(), jevApiKey: "replacement-secret" });
    lockSettingsCredentials();
    unlocked = await unlockChatSettings();
    expect(unlocked.jevApiKey).toBe("replacement-secret");
    expect(unlocked.apiKey).toBe("first-secret");

    // A locked key must never follow a changed provider or destination.
    lockSettingsCredentials();
    await saveChatSettings(updateModelProfile(loadChatSettings(), first.id, {
      provider: "anthropic", endpoint: "https://api.anthropic.com/v1/messages",
    }));
    unlocked = await unlockChatSettings();
    expect(unlocked.apiKey).toBe("");
    expect(unlocked.modelProfiles[0].apiKey).toBe("");
    expect(unlocked.modelProfiles[1].apiKey).toBe("second-secret");

    // Delete/reorder while locked: credentials are attached to stable IDs.
    lockSettingsCredentials();
    const reordered = loadChatSettings();
    await saveChatSettings({ ...reordered, provider: "cli", selectedModelProfileId: "", modelProfiles: reordered.modelProfiles.slice(1) });
    unlocked = await unlockChatSettings();
    expect(unlocked.modelProfiles[0].id).toBe("second");
    expect(unlocked.modelProfiles[0].apiKey).toBe("second-secret");

    await saveChatSettings({ ...unlocked, jevApiKey: "" });
    expect((await unlockChatSettings()).jevApiKey).toBe("");
    await Promise.all([saveChatSettings({ ...loadChatSettings(), systemPrompt: "older" }), saveChatSettings({ ...loadChatSettings(), systemPrompt: "newest" })]);
    expect(loadChatSettings().systemPrompt).toBe("newest");
  } finally {
    lockSettingsCredentials();
    vi.unstubAllGlobals();
  }
});
