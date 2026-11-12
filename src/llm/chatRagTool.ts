import type { ChatToolDefinition, RAGSearchResult } from "../lib/wailsBackend";

export const RAG_SEARCH_TOOL_NAME = "rag_search";
export const MAX_RAG_SEARCHES_PER_TURN = 3;
export const MAX_DYNAMIC_RAG_RESULTS = 3;

// Media scoring details belong in the RAG search panel, not in Chat notices
// or the model's tool warnings. Actual provider/scoring failures remain visible.
export function chatRagWarnings(warnings: readonly string[]): string[] {
  return warnings.filter(warning =>
    !/^\d+ candidate\(s\) could not be scored; their original search positions are preserved\.$/.test(warning) &&
    warning !== "Stopped search-until-found: unscored media is not evidence of low relevance."
  );
}

export const ragSearchTool: ChatToolDefinition = {
  name: RAG_SEARCH_TOOL_NAME,
  description:
    "Search the selected RAG index with a focused semantic query. Use this when the automatically retrieved context is missing, too broad, or suggests a better follow-up query. Searches only the configured RAG index; it does not scan the Workspace directly.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Focused semantic search query. Rephrase or narrow the user's request instead of repeating it unchanged.",
      },
    },
    required: ["query"],
  },
};

/** Tell the model about the selected index without pre-retrieving its content. */
export function ragSearchSystemPrompt(): string {
  return `The selected RAG index is available through the ${RAG_SEARCH_TOOL_NAME} tool. Use it with a self-contained, focused semantic query when the user's request may depend on indexed Workspace knowledge. Do not claim that the index lacks relevant information before searching it. At most ${MAX_RAG_SEARCHES_PER_TURN} RAG searches are allowed per turn; each search returns at most ${MAX_DYNAMIC_RAG_RESULTS} chunks.`;
}

export function formatRagSearchToolResult(
  query: string,
  results: RAGSearchResult[],
  remainingSearches: number,
): string {
  return JSON.stringify({
    query,
    results: results.map((result) => {
      const warnings = chatRagWarnings(result.warnings ?? []);
      return {
        filePath: result.filePath,
        ...(result.pageLabel ? { pageLabel: result.pageLabel } : {}),
        score: result.score,
        ...(result.rerankScore !== undefined ? { rerankScore: result.rerankScore } : {}),
        ...(result.retrievalSource ? { retrievalSource: result.retrievalSource } : {}),
        ...(result.rerankSkippedReason ? { rerankSkippedReason: result.rerankSkippedReason } : {}),
        ...(warnings.length ? { warnings } : {}),
        text: result.text,
        ...(result.jevUnchecked ? { jevUnchecked: true } : {}),
      };
    }),
    remainingSearches,
  });
}

export function mergeRagSources(
  existing: Array<{ path: string; pageLabel?: string; score?: number }>,
  results: RAGSearchResult[],
): Array<{ path: string; pageLabel?: string; score?: number }> {
  const merged = [...existing];
  const seen = new Set(
    merged.map((source) => `${source.path}|${source.pageLabel ?? ""}`),
  );
  for (const result of results) {
    const key = `${result.filePath}|${result.pageLabel ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const warnings = chatRagWarnings(result.warnings ?? []);
    merged.push({
      path: result.filePath,
      ...(result.pageLabel ? { pageLabel: result.pageLabel } : {}),
      score: result.score,
      ...(result.rerankScore !== undefined ? { rerankScore: result.rerankScore } : {}),
      ...(result.retrievalSource ? { retrievalSource: result.retrievalSource } : {}),
      ...(result.rerankSkippedReason ? { rerankSkippedReason: result.rerankSkippedReason } : {}),
      ...(warnings.length ? { warnings } : {}),
    });
  }
  return merged;
}
