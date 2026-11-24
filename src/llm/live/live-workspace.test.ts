import { afterEach, expect, test, vi } from "vitest";
import { defaultChatSettings, defaultRAGSetting } from "../settings";
import { createLiveWorkspaceRunner } from "./live-workspace";
import { liveToolDefinitions } from "./live-tool-definitions";

afterEach(() => vi.unstubAllGlobals());

test("routes Live RAG to the selected Desktop index without opening any Workspace files", async () => {
  const SearchRAG = vi
    .fn()
    .mockResolvedValue([{ filePath: "indexed.md", text: "Indexed passage" }]);
  const ReadLiveWorkspaceTool = vi.fn();
  vi.stubGlobal("window", {
    go: {
      main: {
        App: {
          GetWorkspaceState: async () => ({
            activeWorkspaceId: "test",
            workspaces: [{ id: "test", path: "/test" }],
          }),
          SearchRAG,
          ReadLiveWorkspaceTool,
        },
      },
    },
  });
  const run = createLiveWorkspaceRunner({
    workspace: "/test",
    ragName: "Notes",
    settings: {
      ...defaultChatSettings,
      ragSettings: { Notes: defaultRAGSetting },
    },
    currentFile: () => null,
  });
  expect(
    liveToolDefinitions({
      fileAccess: false,
      discovery: false,
      ragEnabled: true,
    }).map(({ name }) => name),
  ).toEqual(["rag_search"]);
  await expect(
    run(
      { id: "rag-1", name: "rag_search", args: { query: "launch" } },
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({
    results: [{ filePath: "indexed.md", text: "Indexed passage" }],
  });
  expect(SearchRAG).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Notes", query: "launch" }),
  );
  expect(ReadLiveWorkspaceTool).not.toHaveBeenCalled();
});
