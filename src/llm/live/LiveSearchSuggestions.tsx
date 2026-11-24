import { useEffect, useMemo, useRef, useState } from "react";
import { sanitizePreviewDocument } from "../../lib/sanitizeHtml";

const iframeHead =
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline' https:; img-src https: data:; font-src https: data:; base-uri 'none'; form-action 'none'\">" +
  '<base target="_blank"><style>body { margin: 0 }</style>';

export function canRenderLiveSearchSuggestions() {
  if (typeof document === "undefined" || typeof ResizeObserver === "undefined")
    return false;
  const element = document.createElement("iframe");
  return "srcdoc" in element && "sandbox" in element;
}

export function LiveSearchSuggestions({
  html,
  title,
}: {
  html: string;
  title: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(92);
  const document = useMemo(() => {
    const sanitized = sanitizePreviewDocument(html);
    return /<head>/i.test(sanitized)
      ? sanitized.replace(/<head>/i, `<head>${iframeHead}`)
      : `<!doctype html><html><head>${iframeHead}</head><body>${sanitized}</body></html>`;
  }, [html]);

  useEffect(() => {
    const element = frame.current!;
    const contentObserver = new ResizeObserver(resize);
    function resize() {
      const body = element.contentDocument?.body;
      if (body)
        setHeight(Math.min(160, Math.max(1, Math.ceil(body.scrollHeight))));
    }
    function loaded() {
      contentObserver.disconnect();
      const body = element.contentDocument?.body;
      if (body) contentObserver.observe(body);
      resize();
    }
    const widthObserver = new ResizeObserver(resize);
    widthObserver.observe(element);
    element.addEventListener("load", loaded);
    loaded();
    return () => {
      contentObserver.disconnect();
      widthObserver.disconnect();
      element.removeEventListener("load", loaded);
    };
  }, [document]);

  return (
    <iframe
      ref={frame}
      className="live-search-suggestions"
      title={title}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      style={{ height }}
      srcDoc={document}
    />
  );
}
