import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Loader2, LockKeyhole, X } from "lucide-react";
import { useI18n } from "../i18n/context";
import { RememberEncryptionError, type EncryptionRememberDays } from "../lib/rememberedEncryption";
import { EncryptionRememberOptions } from "./EncryptionRememberOptions";

export function CredentialsUnlockDialog({ onUnlock, onClose, rememberSupported, rememberDays, onRememberDaysChange }: {
  onUnlock: (password: string) => Promise<void>;
  onClose: () => void;
  rememberSupported: boolean;
  rememberDays: EncryptionRememberDays;
  onRememberDaysChange: (days: EncryptionRememberDays) => void;
}) {
  const { t: tr } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const formId = useId();
  const titleId = useId();
  const messageId = useId();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    element.querySelector("input")?.focus();
    return () => element.close();
  }, []);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await onUnlock(password);
      setPassword("");
      onClose();
    } catch (reason) {
      setError(reason instanceof RememberEncryptionError ? tr("credentials.rememberFailed")
        : reason instanceof Error && reason.message === "Password is incorrect."
        ? tr("credentials.wrongPassword")
        : tr("credentials.unlockFailed"));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="workflow-prompt-modal credentials-unlock-dialog"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting.current) onClose();
      }}
    >
      <header>
        <div><LockKeyhole size={17} /><strong id={titleId}>{tr("credentials.unlockTitle")}</strong></div>
        <button type="button" disabled={busy} onClick={onClose} aria-label={tr("common.close")}><X size={16} /></button>
      </header>
      <form id={formId} className="workflow-prompt-content" onSubmit={unlock}>
        <p id={messageId}>{tr("credentials.unlockMessage")}</p>
        <label>
          {tr("credentials.password")}
          <input
            autoFocus
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {rememberSupported && (
          <EncryptionRememberOptions days={rememberDays} onChange={onRememberDaysChange} disabled={busy} />
        )}
        {error && <p role="alert" className="dashboard-widget-error">{error}</p>}
        <small>{tr("credentials.cancelHint")}</small>
      </form>
      <footer>
        <button type="button" disabled={busy} onClick={onClose}>{tr("common.cancel")}</button>
        <button type="submit" form={formId} className="primary" disabled={busy || !password}>
          {busy && <Loader2 className="spin" size={14} />}
          {busy ? tr("credentials.unlocking") : tr("credentials.unlock")}
        </button>
      </footer>
    </dialog>
  );
}
