import {
  configureOrUnlockHistoryEncryption,
  historyEncryptionProfile,
  historySessionPassword,
} from "./historyEncryption";
import { forgetEncryptionUnlock, rememberEncryptionUnlock, restoreEncryptionUnlock } from "./wailsBackend";

const RETENTION_KEY = "gemihub-desktop:encryption-unlock-days";
export type EncryptionRememberDays = 0 | 1 | 7 | 30;
export class RememberEncryptionError extends Error {}

export function encryptionRememberDays(): EncryptionRememberDays {
  const stored = localStorage.getItem(RETENTION_KEY);
  const days = stored === null ? 7 : Number(stored);
  return days === 0 || days === 1 || days === 7 || days === 30 ? days : 7;
}

export function setEncryptionRememberDays(days: EncryptionRememberDays): void {
  localStorage.setItem(RETENTION_KEY, String(days));
}

export async function rememberHistoryEncryption(days: EncryptionRememberDays): Promise<void> {
  try {
    if (days === 0) {
      await forgetEncryptionUnlock();
    } else {
      const profile = historyEncryptionProfile();
      const password = historySessionPassword();
      if (!profile || !password) throw new Error("Encryption is locked.");
      await rememberEncryptionUnlock(password, profile.publicKey, days);
    }
    setEncryptionRememberDays(days);
  } catch {
    throw new RememberEncryptionError("Could not remember the encryption unlock.");
  }
}

export async function restoreHistoryEncryption(): Promise<boolean> {
  const profile = historyEncryptionProfile();
  if (!profile) return false;
  try {
    const remembered = await restoreEncryptionUnlock(profile.publicKey);
    if (!remembered) return false;
    if (!remembered.password || remembered.expiresAt <= Date.now()) {
      await forgetEncryptionUnlock();
      return false;
    }
    await configureOrUnlockHistoryEncryption(remembered.password);
    return true;
  } catch {
    // A changed key, Windows account, or unavailable native storage returns to
    // the regular password prompt. It must never block application startup.
    await forgetEncryptionUnlock().catch(() => {});
    return false;
  }
}
