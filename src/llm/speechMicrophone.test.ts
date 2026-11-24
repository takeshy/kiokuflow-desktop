import { afterEach, expect, test, vi } from "vitest";
import { openSpeechMicrophone } from "./speechMicrophone";

afterEach(() => vi.unstubAllGlobals());

test("opens the system default or requests the exact selected microphone", async () => {
  const stream = {} as MediaStream;
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

  await expect(openSpeechMicrophone("")).resolves.toBe(stream);
  expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true });
  await expect(openSpeechMicrophone("usb-mic")).resolves.toBe(stream);
  expect(getUserMedia).toHaveBeenLastCalledWith({
    audio: { deviceId: { exact: "usb-mic" } },
  });
});

test("an unavailable selected microphone fails without falling back to another device", async () => {
  const getUserMedia = vi.fn().mockRejectedValue({ name: "OverconstrainedError" });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

  await expect(openSpeechMicrophone("usb-mic")).rejects.toMatchObject({
    key: "speech.error.selectedMicrophone",
  });
  expect(getUserMedia).toHaveBeenCalledTimes(1);
});
