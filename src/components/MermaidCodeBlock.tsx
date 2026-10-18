import { useEffect, useRef, useState } from "react";
import { renderMermaid } from "../lib/mermaidRender";

export function MermaidCodeBlock({ code, isDark }: { code: string; isDark: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!containerRef.current) return;
      containerRef.current.innerHTML = "";
      setError(null);
      try {
        const result = await renderMermaid({ chart: code, isDark }, () => cancelled);
        if (!cancelled && result && containerRef.current) {
          containerRef.current.innerHTML = result.svg;
          setError(null);
        }
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Failed to render diagram");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, isDark]);

  return (
    <>
      {error && (
        <pre className="code-block error-block">
          <code>{code}</code>
        </pre>
      )}
      <div ref={containerRef} style={{ display: error ? "none" : undefined }} className="mermaid-block" />
    </>
  );
}
