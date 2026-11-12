import { expect, test, vi } from "vitest";
import { chat, onChatStream, searchRAG } from "../lib/wailsBackend";
import { defaultChatSettings, defaultRAGSetting } from "../llm/settings";
import { executeWorkflow } from "./executor";
import type { Workflow, WorkflowLog } from "./types";

vi.mock("../lib/wailsBackend", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/wailsBackend")>(),
  searchRAG: vi.fn(),
  chat: vi.fn(),
  onChatStream: vi.fn(() => () => {}),
  onChatToolRequest: vi.fn(() => () => {}),
}));

test("workflow RAG fallback warnings are retained in the run and delivered once to consumers", async () => {
  const warning = "Gemini reranking failed; returning original search results.";
  vi.mocked(searchRAG).mockResolvedValue([
    { filePath: "one.md", text: "First evidence", score: 0.8, chunkIndex: 0, warnings: [warning] },
    { filePath: "two.md", text: "Second evidence", score: 0.7, chunkIndex: 0, warnings: [warning] },
  ]);
  vi.mocked(chat).mockResolvedValue({ content: "Answer" });
  const workflow: Workflow = {
    nodes: new Map([["answer", {
      id: "answer",
      type: "command",
      properties: { prompt: "Question", ragSetting: "docs", vaultTools: "none", saveTo: "answer" },
    }]]),
    edges: [],
    startNode: "answer",
  };
  const received: WorkflowLog[] = [];
  const run = await executeWorkflow(workflow, "answer.workflow.yaml", {
    chatSettings: { ...defaultChatSettings, ragSettings: { docs: defaultRAGSetting } },
    onLog: entry => received.push(entry),
  });
  expect(run.status, run.error).toBe("completed");
  expect(run.variables.answer).toBe("Answer");
  const warnings = run.logs.filter(entry => entry.message.includes(warning));
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatchObject({ nodeId: "answer", nodeType: "command", status: "info" });
  expect(received).toEqual(run.logs);
  expect(vi.mocked(chat).mock.calls[0][0].messages[0].content).toContain("First evidence");
  expect(onChatStream).toHaveBeenCalled();
});
