import { expect, test } from "vitest";
import { verifyJevSettings } from "./JevSettingsPanel";
import { defaultChatSettings, newModelProfile } from "./settings";

test("Jev verifies the candidate key and mode before committing changes", async () => {
  const settings = { ...defaultChatSettings, jevApiKey: "previous", jevUseOpenRouter: true };
  await expect(verifyJevSettings(settings, "candidate", false, async (key, router) => {
    expect(key).toBe("candidate"); expect(router).toBe(false);
    throw new Error("verification failed");
  })).rejects.toThrow("verification failed");
  expect(settings.jevApiKey).toBe("previous");
  expect(settings.jevUseOpenRouter).toBe(true);
  expect(await verifyJevSettings(settings, " candidate ", false, async () => {}))
    .toEqual({ jevApiKey: "candidate", jevUseOpenRouter: false });
});

test("Jev OpenRouter verification uses only the configured router key", async () => {
  const profile = { ...newModelProfile("openai", false, true), endpoint: "https://openrouter.ai/api/v1", apiKey: "router-key" };
  const settings = { ...defaultChatSettings, modelProfiles: [profile], jevApiKey: "direct-key" };
  expect(await verifyJevSettings(settings, "unused", true, async (key, router) => {
    expect(key).toBe("router-key"); expect(router).toBe(true);
  })).toEqual({ jevApiKey: "direct-key", jevUseOpenRouter: true });
  await expect(verifyJevSettings({ ...settings, modelProfiles: [] }, "direct-key", true, async () => {
    throw new Error("should not request");
  })).rejects.toThrow("unlock");
});
