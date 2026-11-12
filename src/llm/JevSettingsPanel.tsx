import { useEffect, useRef, useState } from "react";
import { verifyJev } from "../lib/wailsBackend";
import { getOpenRouterAPIKey, saveChatSettings, type ChatSettings } from "./settings";

/** Verify the candidate connection before replacing saved keys or mode. */
export async function verifyJevSettings(
  settings: ChatSettings,
  apiKey: string,
  useOpenRouter: boolean,
  verify = verifyJev,
): Promise<Pick<ChatSettings, "jevApiKey" | "jevUseOpenRouter">> {
  const key = useOpenRouter ? getOpenRouterAPIKey(settings) : apiKey.trim();
  if (!key) throw new Error("Enter a TypeSafe key, or configure and unlock the selected OpenRouter key.");
  await verify(key, useOpenRouter);
  return { jevApiKey: useOpenRouter ? settings.jevApiKey : key, jevUseOpenRouter: useOpenRouter };
}

export function JevSettingsPanel({ settings, onChange }: {
  settings: ChatSettings;
  onChange: (settings: ChatSettings) => void;
}) {
  const [key, setKey] = useState(settings.jevApiKey);
  const [router, setRouter] = useState(settings.jevUseOpenRouter);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const latest = useRef(settings);
  latest.current = settings;
  useEffect(() => { setKey(settings.jevApiKey); setRouter(settings.jevUseOpenRouter); }, [settings.jevApiKey, settings.jevUseOpenRouter]);
  const save = async () => {
    setBusy(true);
    setStatus("");
    try {
      const source = latest.current;
      const verified = await verifyJevSettings(source, key, router);
      // A key unlocked or replaced during verification needs another check.
      if (source.jevApiKey !== latest.current.jevApiKey || source.jevUseOpenRouter !== latest.current.jevUseOpenRouter ||
        (router && getOpenRouterAPIKey(source) !== getOpenRouterAPIKey(latest.current))) {
        throw new Error("The saved key changed during verification. Please verify again.");
      }
      const next = { ...latest.current, ...verified };
      await saveChatSettings(next);
      onChange({ ...latest.current, ...verified });
      setStatus("Connection verified and saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };
  return (
    <section className="jev-settings-card">
      <header><div><strong>Jev</strong><small>
        Configure the Jev connection used when Jev is selected for a RAG index.
        Choose OFF, Jev or Gemini separately for each index. Jev or OpenRouter API usage charges apply.
      </small></div></header>
      <>
        <label className="settings-check jev-child-setting">
          <input type="checkbox" checked={router} disabled={busy} onChange={event => setRouter(event.target.checked)} />
          Use the configured OpenRouter key
        </label>
        {!router && <label className="settings-field jev-child-setting">
          <span>Jev API key</span>
          <input type="password" value={key} disabled={busy} autoComplete="off"
            placeholder="Official TypeSafe API key" onChange={event => setKey(event.target.value)} />
          <small className="settings-hint">
            Create a key in the <a href="https://console.typesafe.ai/" target="_blank" rel="noreferrer">official TypeSafe console</a>.
            Direct requests use api.typesafe.ai.
          </small>
        </label>}
        <button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? "Verifying…" : "Verify & save"}
        </button>
        <small className="settings-hint">Unlock saved keys in Settings &gt; Encryption. Failed checks leave the saved connection unchanged.</small>
        {status && <div className="settings-status">{status}</div>}
      </>
    </section>
  );
}
