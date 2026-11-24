import type { ChatToolDefinition } from "../../lib/wailsBackend";
import { ragSearchTool } from "../chatRagTool";

export interface LiveFileAccess {
  fileAccess: boolean;
  discovery: boolean;
  ragEnabled: boolean;
}

export interface LiveToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

const workspaceReadTools: ChatToolDefinition[] = [
  {
    name: "read_current_file",
    description:
      "Read the currently open Workspace file, including unsaved text.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "read_file",
    description:
      "Read a Workspace file. Provide its relative path. Text and PDF text are supported.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        startPage: {
          type: "integer",
          description: "First PDF page, inclusive.",
        },
        endPage: { type: "integer", description: "Last PDF page, inclusive." },
      },
      required: ["path"],
    },
  },
];

const workspaceDiscoveryTools: ChatToolDefinition[] = [
  {
    name: "list_files",
    description: "List files in the active Workspace.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "search_files",
    description: "Search file names and text in the active Workspace.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
];

export function liveToolDefinitions(
  access: LiveFileAccess,
): ChatToolDefinition[] {
  return [
    ...(access.fileAccess ? workspaceReadTools : []),
    ...(access.fileAccess && access.discovery ? workspaceDiscoveryTools : []),
    ...(access.ragEnabled ? [ragSearchTool] : []),
  ];
}
/** Per-call cancellation, deduplication and bounded execution for both transports. */
export class LiveToolDispatcher {
  private calls = new Map<
    string,
    {
      controller: AbortController;
      result: Promise<unknown>;
      cancelled: boolean;
    }
  >();
  constructor(
    private access: LiveFileAccess,
    private execute?: (
      call: LiveToolCall,
      signal: AbortSignal,
    ) => Promise<unknown>,
  ) {}
  run(call: LiveToolCall): Promise<unknown> {
    const previous = this.calls.get(call.id);
    if (previous) return previous.result;
    if (
      !call.id ||
      call.id.length > 200 ||
      !liveToolDefinitions(this.access).some((tool) => tool.name === call.name)
    )
      return Promise.resolve({ error: "This tool is unavailable in Live." });
    if (this.calls.size >= 100)
      return Promise.resolve({
        error: "Live tool limit reached. Start a new conversation.",
      });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const aborted = new Promise<unknown>((resolve) =>
      controller.signal.addEventListener(
        "abort",
        () => resolve({ error: "Tool execution cancelled or timed out." }),
        { once: true },
      ),
    );
    const result = Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        if (
          !call.args ||
          typeof call.args !== "object" ||
          Array.isArray(call.args)
        )
          throw new Error("Invalid tool arguments");
        if (!this.execute) throw new Error("File access is not connected");
        return this.execute(call, controller.signal);
      }),
      aborted,
    ])
      .catch((error) => ({
        error: error instanceof Error ? error.message : "File tool failed",
      }))
      .finally(() => clearTimeout(timer));
    this.calls.set(call.id, { controller, result, cancelled: false });
    return result;
  }
  cancel(ids?: string[]) {
    for (const [id, call] of this.calls)
      if (!ids || ids.includes(id)) {
        call.cancelled = true;
        call.controller.abort();
      }
  }
  isCancelled(id: string) {
    return this.calls.get(id)?.cancelled === true;
  }
}
