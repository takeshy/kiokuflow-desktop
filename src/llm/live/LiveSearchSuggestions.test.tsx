import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveSearchSuggestions } from "./LiveSearchSuggestions";

test("provider suggestions preserve Google links and styles while the iframe blocks scripts", () => {
  const markup = renderToStaticMarkup(
    <LiveSearchSuggestions
      title="Google Search suggestions"
      html={
        '<style>div { color: red }</style><a href="https://www.google.com/search?q=example" onclick="steal()">Example</a><script>steal()</script>'
      }
    />,
  );
  expect(markup).toContain(
    'sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"',
  );
  expect(markup).toContain('referrerPolicy="no-referrer"');
  expect(markup).toContain("Content-Security-Policy");
  expect(markup).toContain("https://www.google.com/search?q=example");
  expect(markup).toContain("color: red");
  expect(markup).not.toContain("steal()");
});
