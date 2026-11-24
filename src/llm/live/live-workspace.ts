import {
  getWorkspaceState,
  readLiveWorkspaceTool,
  searchRAG,
} from "../../lib/wailsBackend";
import { fileRefFromBackendPath, type FileRef } from "../../lib/fileRef";
import { isEncryptedFile } from "../../lib/hybridEncryption";
import {
  MAX_DYNAMIC_RAG_RESULTS,
  RAG_SEARCH_TOOL_NAME,
  chatRagWarnings,
} from "../chatRagTool";
import { resolveRAGSetting, type ChatSettings } from "../settings";
import type { LiveToolCall } from "./live-tool-definitions";

interface WorkspaceOptions {
  workspace: string;
  settings: ChatSettings;
  ragName: string;
  currentFile: () => { path: string; content: string; file?: FileRef } | null;
}

async function checkWorkspace(workspace: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const state = await getWorkspaceState();
  signal.throwIfAborted();
  if (
    !workspace ||
    !state.workspaces.some(
      ({ id, path }) => id === state.activeWorkspaceId && path === workspace,
    )
  ) {
    throw new Error("The active Workspace has changed.");
  }
}

export function createLiveWorkspaceRunner({
  workspace,
  settings,
  ragName,
  currentFile,
}: WorkspaceOptions) {
  return async ({ name, args }: LiveToolCall, signal: AbortSignal) => {
    await checkWorkspace(workspace, signal);
    if (name === "read_current_file") {
      const file = currentFile();
      const ref = file && (file.file ?? fileRefFromBackendPath(file.path));
      if (!file || ref?.scope !== "workspace" || isEncryptedFile(file.content)) {
        throw new Error("No readable Workspace file is open.");
      }
      return {
        path: ref.path,
        content: file.content.slice(0, 32_000),
        truncated: file.content.length > 32_000,
      };
    }
    if (name === RAG_SEARCH_TOOL_NAME) {
      const query =
        typeof args.query === "string" ? args.query.trim().slice(0, 2000) : "";
      const setting = settings.ragSettings[ragName];
      if (!setting || !query)
        throw new Error("Select a RAG index and provide a search query.");
      const results = await searchRAG(ragName, query, {
        ...resolveRAGSetting(settings, setting),
        topK: Math.min(setting.topK, MAX_DYNAMIC_RAG_RESULTS),
      });
      await checkWorkspace(workspace, signal);
      return {
        results: results.map(({ filePath, pageLabel, text, warnings }) => ({
          filePath,
          pageLabel,
          text: text.slice(0, 5000),
          warnings: chatRagWarnings(warnings ?? []),
        })),
      };
    }
    const result = await readLiveWorkspaceTool(workspace, name, args);
    signal.throwIfAborted();
    return result;
  };
}
