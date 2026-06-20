"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { highlightToHtml, normalizeLang } from "@/lib/shiki";

// A highlighted, copyable code block. Used for markdown fences and the YAML artifact
// viewer. Highlighting is async (Shiki); until it resolves we show the raw code in the
// same monospace frame so there is never an empty/unstyled flash.
export function CodeBlock({
  code,
  lang,
  className,
}: {
  readonly code: string;
  readonly lang: string;
  readonly className?: string;
}) {
  const trimmed = code.replace(/\n+$/, "");
  const label = lang.trim() === "" ? "text" : lang.trim().toLowerCase();
  const html = useHighlightedHtml(trimmed, lang);

  return (
    <figure className={`artifact-code group relative my-4 overflow-hidden rounded-[8px] border border-line bg-[#0c0d10] ${className ?? ""}`}>
      <figcaption className="flex items-center justify-between border-b border-line bg-white/[0.02] px-3 py-1.5">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-mute">{label}</span>
        <CopyButton value={trimmed} />
      </figcaption>
      {html !== null ? (
        <div
          className="artifact-code-body scroll-hide overflow-x-auto"
          // Shiki output is its own escaped, trusted HTML — no user markup is interpreted.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="artifact-code-body scroll-hide overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-[1.6] text-fg-body">
          {trimmed}
        </pre>
      )}
    </figure>
  );
}

// Resolve Shiki HTML for the given code/lang. Returns null until the first highlight
// resolves. A per-effect "live" flag drops stale async results when code/lang change
// quickly or under StrictMode's double-invoke.
function useHighlightedHtml(code: string, lang: string): string | null {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setHtml(null);
    highlightToHtml(code, lang)
      .then((out) => {
        if (live) setHtml(out);
      })
      .catch(() => {
        if (live) setHtml(null);
      });
    return () => {
      live = false;
    };
  }, [code, lang]);

  return html;
}

function CopyButton({ value }: { readonly value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  function copy(): void {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy code"}
      className="inline-flex items-center gap-1 rounded-[5px] border border-transparent px-1.5 py-0.5 font-mono text-[10.5px] text-fg-mute opacity-0 transition group-hover:opacity-100 hover:border-line hover:text-fg-body focus-visible:opacity-100"
    >
      {copied ? <Check size={11} className="text-st-done" /> : <Copy size={11} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// Re-export so callers can normalize a fence language for display without importing the lib.
export { normalizeLang };
