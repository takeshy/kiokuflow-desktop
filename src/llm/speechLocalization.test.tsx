import { expect, test } from "vitest";
import { assertEquals, assertStringIncludes } from "../testing/assert";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../i18n/context.tsx";
import { t } from "../i18n/translations.ts";
import { SpeechSettingsPanel } from "./SpeechSettingsPanel.tsx";
import { SpeechActivity } from "./SpeechActivity.tsx";
import { defaultChatSettings, resolveSpeechSettings, selectSpeechEndpoint } from "./settings.ts";
import { speechDraft } from "./speechTranscription";
import { SpeechError, speechErrorMessage } from "./speechErrors.ts";

test("English speech settings contain no fixed Japanese UI text across services", () => {
  for (
    const endpoint of [
      null,
      "openai",
      "gemini-transcribe",
      "vertex-transcribe",
      "whisper-cpp",
      "custom",
    ] as const
  ) {
    const settings = endpoint
      ? selectSpeechEndpoint(
        defaultChatSettings.speech,
        endpoint,
      )
      : defaultChatSettings.speech;
    const html = renderToStaticMarkup(
      <I18nProvider language="en">
        <SpeechSettingsPanel
          settings={settings}
          aiSettings={defaultChatSettings}
          onChange={() => {}}
        />
      </I18nProvider>,
    );
    assertStringIncludes(html, "Voice input");
    assertEquals(/[ぁ-んァ-ヶ一-龠]/u.test(html), false, endpoint ?? "browser");
    if (!endpoint) assertStringIncludes(html, "English (en-US)");
  }
});

test("Japanese speech settings still use Japanese labels", () => {
  const html = renderToStaticMarkup(
    <I18nProvider language="ja">
      <SpeechSettingsPanel
        settings={defaultChatSettings.speech}
        aiSettings={defaultChatSettings}
        onChange={() => {}}
      />
    </I18nProvider>,
  );
  assertStringIncludes(html, "音声入力");
  assertStringIncludes(html, "日本語 (ja-JP)");
  assertStringIncludes(html, 'value="以上"');
});

test("Japanese microphone send phrases default to 以上 across input modes and legacy settings", () => {
  for (const provider of ["browser", "openai-compatible", "live"] as const) {
    for (const sendPhrase of ["over", "over, オーバー"]) {
      const speech = { ...defaultChatSettings.speech, provider, sendPhrase };
      const resolved = resolveSpeechSettings(defaultChatSettings, speech, "ja");
      expect(resolved.sendPhrase).toBe("以上");
      expect(speechDraft("", "確認します。以上。", true, resolved.sendPhrase))
        .toEqual({ text: "確認します。", send: true });
      expect(speechDraft("", "確認します。以上", false, resolved.sendPhrase))
        .toEqual({ text: "確認します。以上", send: false });
      expect(speechDraft("", "以上の内容を確認します", true, resolved.sendPhrase).send).toBe(false);
      expect(speechDraft("", "以上。", true, resolved.sendPhrase))
        .toEqual({ text: "", send: true });
      expect(resolveSpeechSettings(defaultChatSettings, speech, "en").sendPhrase).toBe("over");
    }
  }
});

test("explicit speech language takes priority while custom or disabled send phrases are retained", () => {
  expect(resolveSpeechSettings(defaultChatSettings, { ...defaultChatSettings.speech, language: "ja-JP" }, "en").sendPhrase).toBe("以上");
  expect(resolveSpeechSettings(defaultChatSettings, { ...defaultChatSettings.speech, language: "en-US" }, "ja").sendPhrase).toBe("over");
  for (const sendPhrase of ["", "送信して", "done", "以上"]) {
    expect(resolveSpeechSettings(defaultChatSettings, { ...defaultChatSettings.speech, sendPhrase }, "ja").sendPhrase).toBe(sendPhrase);
  }
});

test("speech activity and service errors follow the UI language", () => {
  for (const status of ["starting", "recording", "preparing", "transcribing"]) {
    const html = renderToStaticMarkup(
      <I18nProvider language="en">
        <SpeechActivity status={status} stream={null} browser={false} />
      </I18nProvider>,
    );
    assertEquals(/[ぁ-んァ-ヶ一-龠]/u.test(html), false);
  }
  const error = new SpeechError("speech.error.auth", "STT HTTP 401: ");
  assertStringIncludes(
    speechErrorMessage(error, (key) => t("en", key)),
    "Check the API key",
  );
  assertStringIncludes(
    speechErrorMessage(error, (key) => t("ja", key)),
    "認証設定",
  );
  assertEquals(
    speechErrorMessage(new Error("External error"), (key) => t("en", key)),
    "External error",
  );
});
