import {
  externalHTTPRequest,
  type ExternalHTTPResponse,
} from "../../lib/wailsBackend";
import { geminiLiveSetup } from "./gemini-live-config";
import { liveLanguageInstructions, type LiveOptions } from "./live-session";
import { liveToolDefinitions } from "./live-tool-definitions";

function responseError(
  response: ExternalHTTPResponse,
  service: string,
  apiKey: string,
): Error {
  let message: unknown;
  try {
    message = JSON.parse(response.body)?.error?.message;
  } catch {
    // The service may return an empty or non-JSON error response.
  }
  return new Error(
    typeof message === "string" && apiKey
      ? message.replaceAll(apiKey, "[redacted]").slice(0, 1000)
      : `${service} HTTP ${response.status}`,
  );
}

export async function createGeminiLiveToken(
  options: LiveOptions,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const response = await externalHTTPRequest({
    url: "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": options.apiKey,
    },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(Date.now() + 30 * 60_000).toISOString(),
      newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
      bidiGenerateContentSetup: geminiLiveSetup(options),
    }),
  });
  signal.throwIfAborted();
  if (response.status < 200 || response.status >= 300)
    throw responseError(response, "Gemini Live", options.apiKey);
  const name = JSON.parse(response.body)?.name;
  if (typeof name !== "string" || !/^auth_tokens\/\S{1,8000}$/.test(name)) {
    throw new Error("Gemini returned an invalid Live token.");
  }
  return name;
}

export async function answerOpenAILiveOffer(
  options: LiveOptions,
  sdp: string,
  signal: AbortSignal,
): Promise<string> {
  if (!sdp) throw new Error("WebRTC did not produce an SDP offer.");
  const form = new FormData();
  form.set("sdp", sdp);
  form.set(
    "session",
    JSON.stringify({
      type: "realtime",
      model: options.model,
      instructions: [
        options.instructions,
        liveLanguageInstructions(options.language),
      ]
        .filter(Boolean)
        .join("\n\n"),
      tools: liveToolDefinitions(options).map((tool) => ({
        type: "function",
        ...tool,
      })),
      audio: {
        input: {
          transcription: { model: "gpt-4o-mini-transcribe" },
          turn_detection: {
            type: "server_vad",
            create_response: true,
            interrupt_response: true,
          },
        },
        output: { voice: options.voice },
      },
    }),
  );
  const encoded = new Response(form);
  const body = await encoded.text();
  signal.throwIfAborted();
  const response = await externalHTTPRequest({
    url: "https://api.openai.com/v1/realtime/calls",
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": encoded.headers.get("Content-Type")!,
    },
    body,
  });
  signal.throwIfAborted();
  if (response.status < 200 || response.status >= 300)
    throw responseError(response, "OpenAI Realtime", options.apiKey);
  const answer = response.body || atob(response.bodyBase64);
  if (!answer.startsWith("v=0"))
    throw new Error("OpenAI returned an invalid SDP answer.");
  return answer;
}
