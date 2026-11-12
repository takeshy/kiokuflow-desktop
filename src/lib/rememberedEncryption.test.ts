import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { encryptionRememberDays, rememberHistoryEncryption, restoreHistoryEncryption, RememberEncryptionError } from "./rememberedEncryption";

const state = vi.hoisted(() => ({
  profile: { publicKey: "test-public-key", encryptedPrivateKey: "test-protected-key", salt: "test-salt" } as { publicKey: string; encryptedPrivateKey: string; salt: string } | null,
  password: "test-session-password",
  configure: vi.fn(),
  remember: vi.fn(),
  restore: vi.fn(),
  forget: vi.fn(),
}));

vi.mock("./historyEncryption", () => ({
  historyEncryptionProfile: () => state.profile,
  historySessionPassword: () => state.password,
  configureOrUnlockHistoryEncryption: state.configure,
}));
vi.mock("./wailsBackend", () => ({
  rememberEncryptionUnlock: state.remember,
  restoreEncryptionUnlock: state.restore,
  forgetEncryptionUnlock: state.forget,
}));

let stored: Map<string, string>;
beforeEach(() => {
  vi.resetAllMocks();
  stored = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
  state.profile = { publicKey: "test-public-key", encryptedPrivateKey: "test-protected-key", salt: "test-salt" };
  state.password = "test-session-password";
  state.configure.mockResolvedValue(undefined);
  state.remember.mockResolvedValue(undefined);
  state.forget.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

test("the default is seven days; only the period is stored in browser settings", async () => {
  expect(encryptionRememberDays()).toBe(7);
  await rememberHistoryEncryption(7);
  expect(state.remember).toHaveBeenCalledWith("test-session-password", "test-public-key", 7);
  expect([...stored.values()]).toEqual(["7"]);
  stored.set("gemihub-desktop:encryption-unlock-days", "999");
  expect(encryptionRememberDays()).toBe(7);
});

test("session-only removes the native unlock even while encryption is locked", async () => {
  state.password = "";
  await rememberHistoryEncryption(0);
  expect(state.forget).toHaveBeenCalledOnce();
  expect(state.remember).not.toHaveBeenCalled();
  expect(encryptionRememberDays()).toBe(0);
});

test("restoring a valid unlock verifies the password without renewing retention", async () => {
  state.restore.mockResolvedValue({ password: "restored-password", expiresAt: Date.now() + 60000 });
  expect(await restoreHistoryEncryption()).toBe(true);
  expect(state.restore).toHaveBeenCalledWith("test-public-key");
  expect(state.configure).toHaveBeenCalledWith("restored-password");
  expect(state.remember).not.toHaveBeenCalled();
  expect(stored.size).toBe(0);
});

test.each(["missing", "expired", "incorrect-password", "native-unavailable"])("%s unlock falls back to password entry", async (scenario) => {
  if (scenario === "missing") state.restore.mockResolvedValue(null);
  else if (scenario === "native-unavailable") state.restore.mockRejectedValue(new Error("Unavailable"));
  else state.restore.mockResolvedValue({ password: "restored-password", expiresAt: Date.now() + (scenario === "expired" ? -1 : 60000) });
  if (scenario === "incorrect-password") state.configure.mockRejectedValue(new Error("Password is incorrect."));
  expect(await restoreHistoryEncryption()).toBe(false);
  if (scenario !== "missing") expect(state.forget).toHaveBeenCalledOnce();
  if (scenario === "expired") expect(state.configure).not.toHaveBeenCalled();
});

test("a failed native save is reported and does not change the saved period", async () => {
  state.remember.mockRejectedValue(new Error("Access denied"));
  await expect(rememberHistoryEncryption(30)).rejects.toBeInstanceOf(RememberEncryptionError);
  expect(stored.size).toBe(0);
});

test("no encryption profile means there is nothing to restore", async () => {
  state.profile = null;
  expect(await restoreHistoryEncryption()).toBe(false);
  expect(state.restore).not.toHaveBeenCalled();
});

test("native read and removal errors still allow the normal password prompt", async () => {
  state.restore.mockRejectedValue(new Error("Read failed"));
  state.forget.mockRejectedValue(new Error("Removal failed"));
  expect(await restoreHistoryEncryption()).toBe(false);
});
