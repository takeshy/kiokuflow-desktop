import { test } from "vitest";
import { assertEquals, assertStringIncludes } from "../testing/assert";
import {
  chatRagWarnings,
  formatRagSearchToolResult,
  mergeRagSources,
  ragSearchSystemPrompt,
} from "./chatRagTool.ts";

test("Chat hides media scoring notices while retaining actual reranking failures", () => {
  const media = "5 candidate(s) could not be scored; their original search positions are preserved.";
  const stopped = "Stopped search-until-found: unscored media is not evidence of low relevance.";
  const failure = "gemini reranking failed; returning original search results: HTTP 503";
  assertEquals(chatRagWarnings([media, stopped]), []);
  assertEquals(chatRagWarnings([media, failure, stopped]), [failure]);
  const result = {
    filePath: "scan.pdf", text: "[pdf: scan.pdf]", chunkIndex: 0, score: 0.8,
    warnings: [media, stopped], jevUnchecked: true,
  };
  const toolResult = JSON.parse(formatRagSearchToolResult("query", [result], 1));
  assertEquals(toolResult.results[0].warnings, undefined);
  assertEquals(toolResult.results[0].jevUnchecked, true);
  assertEquals(mergeRagSources([], [result]), [{ path: "scan.pdf", score: 0.8 }]);
  const failed = JSON.parse(formatRagSearchToolResult("query", [{ ...result, warnings: [media, failure] }], 1));
  assertEquals(failed.results[0].warnings, [failure]);
  // Filtering Chat must not remove the full diagnostic list from RAG results.
  assertEquals(result.warnings, [media, stopped]);
});

test("dynamic RAG results include chunk text and remaining budget", () => {
  const value = formatRagSearchToolResult("focused", [{
    filePath: "Notes/a.md",
    text: "answer",
    score: 0.9,
    chunkIndex: 0,
  }], 1);
  assertStringIncludes(value, '"text":"answer"');
  assertStringIncludes(value, '"remainingSearches":1');
});

test("RAG source merging removes duplicate citations", () => {
  assertEquals(
    mergeRagSources([{ path: "a.md", score: 0.8 }], [{
      filePath: "a.md",
      text: "same file",
      score: 0.9,
      chunkIndex: 1,
    }, {
      filePath: "b.pdf",
      pageLabel: "Page 2",
      text: "new file",
      score: 0.7,
      chunkIndex: 0,
    }]),
    [{ path: "a.md", score: 0.8 }, {
      path: "b.pdf",
      pageLabel: "Page 2",
      score: 0.7,
    }],
  );
});

test("the RAG prompt exposes on-demand search without claiming automatic retrieval", () => {
  const prompt = ragSearchSystemPrompt();
  assertStringIncludes(
    prompt,
    "Use it with a self-contained, focused semantic query",
  );
  assertStringIncludes(prompt, "At most 3 RAG searches");
  assertEquals(prompt.includes("automatic"), false);
});
