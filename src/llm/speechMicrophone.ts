import { SpeechError } from "./speechErrors";

export async function openSpeechMicrophone(
  microphoneId: string,
  constraints?: MediaTrackConstraints,
): Promise<MediaStream> {
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    throw new SpeechError("speech.error.microphoneUnavailable");
  }
  try {
    return await mediaDevices.getUserMedia({
      audio: microphoneId
        ? { ...constraints, deviceId: { exact: microphoneId } }
        : constraints ?? true,
    });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new SpeechError(
        microphoneId ? "speech.error.selectedMicrophone" : "speech.error.noMicrophone",
      );
    }
    if (name === "NotAllowedError") {
      throw new SpeechError("speech.error.microphonePermission");
    }
    if (name === "NotReadableError") {
      throw new SpeechError("speech.error.microphoneBusy");
    }
    throw error;
  }
}
