import { useEffect, useId, useRef, useState } from "react";
import { AudioLines, Mic, MicOff, PhoneOff, X } from "lucide-react";
import { useI18n } from "../../i18n/context";
import type { ChatMessage } from "../../lib/wailsBackend";
import type { FileRef } from "../../lib/fileRef";
import type { ChatSettings } from "../settings";
import { speechErrorMessage } from "../speechErrors";
import { RAG_SEARCH_TOOL_NAME } from "../chatRagTool";
import { GeminiLiveSession } from "./gemini-live";
import { GEMINI_LIVE_MODELS, GEMINI_LIVE_VOICES } from "./gemini-live-config";
import { OpenAILiveSession, LIVE_MODELS, LIVE_VOICES } from "./openai-live";
import {
  liveAPIKey,
  liveInstructions,
  type LiveProvider,
  type LiveSession,
  type LiveState,
  type LiveTranscript,
} from "./live-session";
import { createLiveWorkspaceRunner } from "./live-workspace";
import type { LiveCallbacks } from "./live-session";
import {
  canRenderLiveSearchSuggestions,
  LiveSearchSuggestions,
} from "./LiveSearchSuggestions";

type RagReport =
  | { type: "pending" }
  | { type: "results"; count: number }
  | { type: "error"; message: string };

interface LiveConversationProps {
  settings: ChatSettings;
  workspace: string;
  messages: readonly ChatMessage[];
  currentFile: { path: string; content: string; file?: FileRef } | null;
  onClose: (messages: ChatMessage[]) => void;
}

export function LiveConversation({
  settings,
  workspace,
  messages,
  currentFile,
  onClose,
}: LiveConversationProps) {
  const { t, language } = useI18n();
  const titleId = useId();
  const geminiKey = liveAPIKey(settings, "gemini");
  const openAIKey = liveAPIKey(settings, "openai");
  const [provider, setProvider] = useState<LiveProvider>(
    openAIKey && (settings.provider === "openai" || !geminiKey)
      ? "openai"
      : "gemini",
  );
  const [state, setState] = useState<LiveState>("idle");
  const [model, setModel] = useState<string>("");
  const [voice, setVoice] = useState<string>("");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [transcript, setTranscript] = useState<LiveTranscript[]>([]);
  const [includeContext, setIncludeContext] = useState(true);
  const [fileAccess, setFileAccess] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [searchSupported] = useState(canRenderLiveSearchSuggestions);
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [ragName, setRagName] = useState(settings.selectedRagSetting ?? "");
  const [ragReport, setRagReport] = useState<RagReport | null>(null);
  const ragSearchID = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const session = useRef<LiveSession | null>(null);
  const currentFileRef = useRef(currentFile);
  const transcriptRef = useRef<LiveTranscript[]>([]);
  const closing = useRef(false);
  currentFileRef.current = currentFile;

  const apiKey = provider === "gemini" ? geminiKey : openAIKey;
  const models = provider === "gemini" ? GEMINI_LIVE_MODELS : LIVE_MODELS;
  const voices = provider === "gemini" ? GEMINI_LIVE_VOICES : LIVE_VOICES;
  const selectedModel = model || models[0];
  const selectedVoice = voice || voices[0];
  const hasTranscript = transcript.some(({ text }) => text.trim());
  const canConfigure = state === "idle" && !hasTranscript;
  const canReadFiles = !!workspace && settings.fileToolMode !== "none";
  const canDiscover = canReadFiles && settings.fileToolMode !== "noSearch";
  const useFiles = fileAccess && canReadFiles;
  const showWebSearch = provider === "gemini" && searchSupported;
  const useWebSearch = showWebSearch && webSearch;
  const ragNames = Object.keys(settings.ragSettings);
  const selectedRag = workspace && ragNames.includes(ragName) ? ragName : "";

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    const stop = () => session.current?.stop();
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      stop();
      element.close();
    };
  }, []);

  function close() {
    if (closing.current) return;
    closing.current = true;
    session.current?.stop();
    onClose(
      transcriptRef.current.flatMap(({ role, text }) =>
        text.trim()
          ? [
              {
                id: crypto.randomUUID(),
                role,
                content: text,
                ...(role === "assistant"
                  ? { provider, model: selectedModel }
                  : {}),
              },
            ]
          : [],
      ),
    );
  }

  function start() {
    if (!canConfigure || !apiKey || !audio.current) return;
    session.current?.stop();
    setError("");
    setMuted(false);
    setPlaybackBlocked(false);
    setSearchSuggestions([]);
    setRagReport(null);
    const access = {
      fileAccess: useFiles,
      discovery: useFiles && canDiscover,
      ragEnabled: !!selectedRag,
    };
    const runTool = createLiveWorkspaceRunner({
      workspace,
      settings,
      ragName: selectedRag,
      currentFile: () => currentFileRef.current,
    });
    const callbacks: LiveCallbacks = {
      audio: audio.current,
      onState: setState,
      onTranscript: (items) => {
        transcriptRef.current = useWebSearch ? [] : items;
        setTranscript(items);
      },
      onSearchSuggestions: useWebSearch
        ? (html) =>
            setSearchSuggestions((previous) =>
              previous.includes(html) ? previous : [...previous, html],
            )
        : undefined,
      onError: (caught) => setError(speechErrorMessage(caught, t)),
      onPlaybackBlocked: () => setPlaybackBlocked(true),
      onToolCall: async (call, signal) => {
        if (call.name !== RAG_SEARCH_TOOL_NAME) return runTool(call, signal);
        const id = ++ragSearchID.current;
        setRagReport({ type: "pending" });
        const cancel = () => {
          if (ragSearchID.current === id) setRagReport(null);
        };
        signal.addEventListener("abort", cancel, { once: true });
        try {
          const result = await runTool(call, signal);
          if (
            !signal.aborted &&
            ragSearchID.current === id &&
            result &&
            typeof result === "object" &&
            "results" in result &&
            Array.isArray(result.results)
          ) {
            setRagReport({ type: "results", count: result.results.length });
          }
          return result;
        } catch (caught) {
          if (!signal.aborted && ragSearchID.current === id) {
            setRagReport({
              type: "error",
              message: speechErrorMessage(caught, t),
            });
          }
          throw caught;
        } finally {
          signal.removeEventListener("abort", cancel);
        }
      },
    };
    const active =
      provider === "gemini"
        ? new GeminiLiveSession(callbacks)
        : new OpenAILiveSession(callbacks);
    session.current = active;
    void active.start({
      apiKey,
      model: selectedModel,
      voice: selectedVoice,
      microphoneId: settings.speech.microphoneId,
      instructions: liveInstructions(
        settings.systemPrompt,
        includeContext ? messages : [],
        access,
      ),
      language,
      webSearch: useWebSearch,
      ...access,
    });
  }

  return (
    <dialog
      ref={dialog}
      className="live-conversation"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id={titleId}>
          <AudioLines size={18} />
          {t("live.title")}
        </h2>
        <button
          className="chat-clear"
          type="button"
          onClick={close}
          aria-label={t("live.close")}
        >
          <X size={16} />
        </button>
      </header>
      <div className="live-conversation-body">
        <p>{t("live.notice")}</p>
        <div className="live-conversation-options">
          <label className="settings-field">
            <span>{t("live.provider")}</span>
            <select
              disabled={!canConfigure}
              value={provider}
              onChange={(event) => {
                setProvider(
                  event.target.value === "openai" ? "openai" : "gemini",
                );
                setModel("");
                setVoice("");
                setError("");
              }}
            >
              <option value="gemini">Gemini</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <label className="settings-field">
            <span>{t("live.model")}</span>
            <select
              disabled={!canConfigure}
              value={selectedModel}
              onChange={(event) => setModel(event.target.value)}
            >
              {models.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>{t("live.voice")}</span>
            <select
              disabled={!canConfigure}
              value={selectedVoice}
              onChange={(event) => setVoice(event.target.value)}
            >
              {voices.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
        {!apiKey && <p>{t("live.keyRequired")}</p>}
        <label className="live-conversation-check">
          <input
            type="checkbox"
            checked={includeContext}
            disabled={!canConfigure}
            onChange={(event) => setIncludeContext(event.target.checked)}
          />
          {t("live.context")}
        </label>
        {canReadFiles && (
          <label className="live-conversation-check">
            <input
              type="checkbox"
              checked={fileAccess}
              disabled={!canConfigure}
              onChange={(event) => setFileAccess(event.target.checked)}
            />
            {t(canDiscover ? "live.fileSearch" : "live.fileAccess")}
          </label>
        )}
        {showWebSearch && (
          <label className="live-conversation-check">
            <input
              type="checkbox"
              checked={webSearch}
              disabled={!canConfigure}
              onChange={(event) => setWebSearch(event.target.checked)}
            />
            {t("live.webSearch")}
          </label>
        )}
        {useWebSearch && <p>{t("live.webSearchHistory")}</p>}
        {!!workspace && ragNames.length > 0 && (
          <label className="settings-field">
            <span>{t("live.rag")}</span>
            <select
              value={selectedRag}
              disabled={!canConfigure}
              onChange={(event) => {
                setRagName(event.target.value);
                setRagReport(null);
              }}
            >
              <option value="">{t("live.noRag")}</option>
              {ragNames.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        )}
        <p role="status">
          {t(
            state === "idle"
              ? hasTranscript
                ? "live.stopped"
                : "live.ready"
              : `live.${state}`,
          )}
        </p>
        {selectedRag && (
          <p role="status">
            {ragReport?.type === "pending"
              ? t("live.ragPending")
              : ragReport?.type === "results"
                ? `${t("live.ragResults")}: ${ragReport.count}`
                : ragReport?.type === "error"
                  ? `${t("live.ragFailed")}: ${ragReport.message}`
                  : t("live.ragNotRun")}
          </p>
        )}
        {error && (
          <p className="chat-error" role="alert">
            {error}
          </p>
        )}
        {playbackBlocked && state === "connected" && (
          <button
            type="button"
            className="speech-secondary-button"
            onClick={() => {
              void audio.current
                ?.play()
                .then(() => setPlaybackBlocked(false))
                .catch(() => {});
            }}
          >
            {t("live.playAudio")}
          </button>
        )}
        {hasTranscript && (
          <div
            className="live-conversation-transcript"
            aria-label={t("live.transcript")}
          >
            {transcript
              .filter(({ text }) => text.trim())
              .map(({ id, role, text }) => (
                <div key={id}>
                  <strong>
                    {role === "user"
                      ? t("live.you")
                      : provider === "gemini"
                        ? "Gemini"
                        : "OpenAI"}
                  </strong>
                  <p>{text}</p>
                </div>
              ))}
          </div>
        )}
        {searchSuggestions.map((html) => (
          <LiveSearchSuggestions
            key={html}
            html={html}
            title={t("live.searchSuggestions")}
          />
        ))}
        <audio ref={audio} autoPlay playsInline hidden />
      </div>
      <footer>
        {canConfigure ? (
          <button
            type="button"
            className="live-conversation-primary"
            disabled={!apiKey}
            onClick={start}
          >
            <Mic size={15} />
            {t("live.start")}
          </button>
        ) : (
          <>
            {state !== "idle" && (
              <button
                type="button"
                className="speech-secondary-button"
                disabled={state !== "connected"}
                aria-pressed={muted}
                onClick={() => {
                  session.current?.mute(!muted);
                  setMuted(!muted);
                }}
              >
                {muted ? <MicOff size={15} /> : <Mic size={15} />}
                {t(muted ? "live.unmute" : "live.mute")}
              </button>
            )}
            <button
              type="button"
              className="live-conversation-primary"
              onClick={close}
            >
              <PhoneOff size={15} />
              {t(state === "idle" ? "live.back" : "live.end")}
            </button>
          </>
        )}
      </footer>
    </dialog>
  );
}
