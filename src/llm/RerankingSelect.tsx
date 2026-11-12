import { ChevronDown, Loader2, ShieldCheck } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { verifyRAGReranker, type RAGSetting, type RAGRerankProvider } from "../lib/wailsBackend";
import { resolveRAGSetting, type ChatSettings } from "./settings";
import { rerankingCredentialIssue, type RerankingSettingsSection } from "./rerankingCredentials";

export function RerankingSelect({ settings, rag, ragName, value, onChange, onOpenSettings }: {
  settings: ChatSettings;
  rag: RAGSetting;
  ragName?: string;
  value?: RAGRerankProvider;
  onChange: (provider: RAGRerankProvider) => void;
  onOpenSettings?: (section: RerankingSettingsSection) => void;
}) {
  const selectId = useId();
  const [busy, setBusy] = useState(false);
  const provider = value ?? "off";
  const resolved = resolveRAGSetting(settings, { ...rag, rerankProvider: provider });
  const key = provider === "gemini" ? resolved.geminiApiKey : resolved.jevApiKey;
  const useOpenRouter = provider === "jev" && resolved.jevUseOpenRouter;
  const credentialIssue = rerankingCredentialIssue(settings, rag, provider, ragName);
  const connection = useMemo(() => ({ provider, key, useOpenRouter }), [provider, key, useOpenRouter]);
  const [verification, setVerification] = useState<{ connection: typeof connection; message: string } | null>(null);
  const status = verification?.connection === connection ? verification.message : "";
  const verify = async () => {
    setBusy(true); setVerification(null);
    try {
      if (!key || credentialIssue) throw new Error(credentialIssue?.message ?? "No API key is configured for the selected provider.");
      await verifyRAGReranker(provider, key, useOpenRouter);
      setVerification({ connection, message: "Connection verified." });
    } catch (error) { setVerification({ connection, message: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); }
  };
  return (
    <div className="settings-field reranking-field">
      <label htmlFor={selectId}><span>Reranking</span></label>
      <div className="reranking-controls">
        <div className="reranking-select-wrap">
          <select
            id={selectId}
            className="settings-select reranking-select"
            aria-describedby={`${selectId}-hint`}
            value={provider}
            disabled={busy}
            onChange={event => {
              setVerification(null);
              onChange(event.target.value as RAGRerankProvider);
            }}
          >
            <option value="off">OFF</option>
            <option value="jev">Jev</option>
            <option value="gemini">Gemini Decisions API</option>
          </select>
          <ChevronDown size={16} aria-hidden="true" />
        </div>
        {provider !== "off" && (
          <button
            type="button"
            className="settings-choice reranking-verify"
            disabled={busy}
            onClick={() => void verify()}
          >
            {busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}
            {busy ? "Verifying…" : "Verify connection"}
          </button>
        )}
      </div>
      <small id={`${selectId}-hint`} className="settings-hint">
        No selection means OFF. Top K limits final results. Relevance is scored from 0 to 3; scoring failures keep the original search order with a warning.
      </small>
      {status && (
        <div className="reranking-feedback">
          <small className={`settings-status${status === "Connection verified." ? " ok" : ""}`} role="status">
            {status}
          </small>
          {credentialIssue && onOpenSettings && (
            <button type="button" className="settings-choice" onClick={() => onOpenSettings(credentialIssue.section)}>
              {credentialIssue.action}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
