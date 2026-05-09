import type { ReactNode } from "react";

// Renders the tiny subset of inline markdown the plan fixture uses:
// `code`, **bold**, *italic*. Order matters — code is tokenized first so
// asterisks inside backticks aren't interpreted.
const TOKEN_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;

export function InlineMd({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const [, code, bold, italic] = m;
    if (code) {
      out.push(
        <code
          key={i++}
          className="rounded-[3px] bg-white/[0.04] px-1.5 py-px font-mono text-[12px] text-fg"
        >
          {code.slice(1, -1)}
        </code>,
      );
    } else if (bold) {
      out.push(
        <strong key={i++} className="font-semibold text-fg">
          {bold.slice(2, -2)}
        </strong>,
      );
    } else if (italic) {
      out.push(
        <em key={i++} className="italic">
          {italic.slice(1, -1)}
        </em>,
      );
    }
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
