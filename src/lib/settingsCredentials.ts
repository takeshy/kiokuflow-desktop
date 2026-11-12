import { decryptData, decryptPrivateKey, encryptData } from "./hybridEncryption";
import { historyEncryptionProfile, historySessionPassword } from "./historyEncryption";

type SettingsDocument = Record<string, unknown>;
type CipherMap = Record<string, string>;
const secretNames = new Set(["apiKey", "jevApiKey", "embeddingApiKey", "vertexOAuthClientSecret", "oauthClientSecret", "localPassword", "password", "botToken"]);
const sessionValues = new Map<string, string>();

export function hasLockedSettingsCredentials(document: { encryptedCredentials?: CipherMap }): boolean {
  if (!historyEncryptionProfile()) return false;
  return Object.values((document.encryptedCredentials ?? {}) as CipherMap)
    .some((cipher) => !!cipher && !sessionValues.has(cipher));
}

// Array entries with IDs use stable paths, so deleting/reordering profiles
// cannot attach a saved key to a different connection.
function visit(value: unknown, transform: (path: string, value: string) => string, path: string[] = []): unknown {
  if (Array.isArray(value)) return value.map((item, index) => visit(item, transform, [...path, String(item?.id ?? index)]));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "encryptedCredentials").map(([key, item]) => [
    key, secretNames.has(key) && typeof item === "string"
      ? transform(JSON.stringify([...path, key]), item)
      : visit(item, transform, [...path, key]),
  ]));
}

export function hydrateSettingsCredentials<T extends SettingsDocument>(document: T): T {
  const encrypted = (document.encryptedCredentials ?? {}) as CipherMap;
  const hydrated = visit(document, (path, value) => encrypted[path] ? sessionValues.get(encrypted[path]) ?? "" : value) as T;
  return { ...hydrated, ...(Object.keys(encrypted).length ? { encryptedCredentials: encrypted } : {}) };
}

export async function protectSettingsCredentials<T extends SettingsDocument>(document: T, previous?: SettingsDocument): Promise<T> {
  const profile = historyEncryptionProfile();
  if (!profile) return document;
  const current = (document.encryptedCredentials ?? {}) as CipherMap;
  const saved = { ...current, ...(previous?.encryptedCredentials as CipherMap ?? {}) };
  const encrypted: CipherMap = {};
  const secrets: Array<{ path: string; value: string }> = [];
  const stripped = visit(document, (path, value) => { secrets.push({ path, value }); return ""; }) as T;
  const reused = new Map<string, string>();
  for (const { path, value } of secrets) {
    // An explicit deletion also clears a locked key. Empty ciphertext markers
    // are kept in the editing state until the next successful save.
    const old = current[path] === "" ? undefined : saved[path];
    if (!value) {
      // A blank input for a locked key must preserve its ciphertext.
      if (old && !sessionValues.has(old)) encrypted[path] = old;
      continue;
    }
    const cipher = old && sessionValues.get(old) === value ? old
      : reused.get(value) ?? await encryptData(value, profile.publicKey);
    encrypted[path] = cipher;
    reused.set(value, cipher);
    sessionValues.set(cipher, value);
  }
  return { ...stripped, encryptedCredentials: encrypted };
}

export async function unlockSettingsCredentials(document: SettingsDocument): Promise<void> {
  const profile = historyEncryptionProfile();
  if (!profile) return;
  const encrypted = Object.values((document.encryptedCredentials ?? {}) as CipherMap);
  if (!encrypted.length) return;
  const privateKey = await decryptPrivateKey(profile.encryptedPrivateKey, profile.salt, historySessionPassword());
  const values = await Promise.all([...new Set(encrypted)].map(async cipher => [cipher, await decryptData(cipher, privateKey)] as const));
  for (const [cipher, value] of values) sessionValues.set(cipher, value);
}

export function lockSettingsCredentials(): void { sessionValues.clear(); }
