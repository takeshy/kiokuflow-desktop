import { useI18n } from "../i18n/context";
import type { EncryptionRememberDays } from "../lib/rememberedEncryption";

export function EncryptionRememberOptions({ days, onChange, disabled = false }: {
  days: EncryptionRememberDays;
  onChange: (days: EncryptionRememberDays) => void;
  disabled?: boolean;
}) {
  const { t: tr } = useI18n();
  return (
    <div className="encryption-remember-options">
      <label className="settings-field">
        <span>{tr("credentials.remember")}</span>
        <select className="settings-select" value={days} disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value) as EncryptionRememberDays)}>
          <option value={0}>{tr("credentials.rememberSession")}</option>
          <option value={1}>{tr("credentials.rememberDay")}</option>
          <option value={7}>{tr("credentials.rememberWeek")}</option>
          <option value={30}>{tr("credentials.rememberMonth")}</option>
        </select>
      </label>
      <small>{tr("credentials.rememberHint")}</small>
    </div>
  );
}
