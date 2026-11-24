import { expect, test } from "vitest";
import { assertStringIncludes } from "../testing/assert";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownPreview } from "./MarkdownPreview.tsx";

test("Markdown tables render in the dashboard and scroll locally in chat", () => {
  const content = "| Name |\n| --- |\n| Example |";
  const plain = renderToStaticMarkup(<MarkdownPreview content={content} isDark={false} />);
  expect(plain).toContain("<table>");
  expect(plain).toContain("<td>Example</td>");
  expect(plain).not.toContain("markdown-table-scroll");

  const scrollable = renderToStaticMarkup(<MarkdownPreview content={content} isDark={false} scrollTables />);
  expect(scrollable).toContain('<div class="markdown-table-scroll"><table>');
  expect(scrollable).toContain("<td>Example</td>");
});

test("MarkdownPreview preserves Windows file links for local handling", () => {
  const html = renderToStaticMarkup(
    React.createElement(MarkdownPreview, {
      content: "[Canvas](C:\\Users\\takes\\Vault\\overview.canvas)",
      isDark: false,
      onLinkClick: () => undefined,
    }),
  );

  assertStringIncludes(html, 'class="markdown-link-button"');
  assertStringIncludes(html, ">Canvas</button>");
});

test("MarkdownPreview preserves the generated Japanese Canvas link", () => {
  const name = "人材マッチング業界におけるAI活用の最新動向（2026年）.canvas";
  const html = renderToStaticMarkup(
    React.createElement(MarkdownPreview, {
      content: `[${name}](C:\\Users\\takes\\takeshy\\${name})`,
      isDark: false,
      onLinkClick: () => undefined,
    }),
  );

  assertStringIncludes(html, 'class="markdown-link-button"');
  assertStringIncludes(html, `${name}</button>`);
});
