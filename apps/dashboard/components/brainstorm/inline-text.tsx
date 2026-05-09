/**
 * Tiny inline-formatter for brainstorm transcript text. Mock fixtures
 * emit a constrained subset:
 *   - paragraphs separated by `\n\n`
 *   - lines starting with `> ` render as a quoted block
 *   - inline `**bold**` and `` `code` ``
 *
 * Everything else passes through as plain text. This is deliberately not a
 * full markdown parser — turns are short, and richer structure would belong
 * in the spec column, not the transcript.
 */
export function InlineText({ text }: { text: string }) {
  const blocks = splitBlocks(text);
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === "quote" ? (
          <p
            key={i}
            className="mt-1.5 border-l-2 border-line-strong pl-2.5 text-[12.5px] text-fg-mute first:mt-0"
          >
            <Inline text={b.text} />
          </p>
        ) : (
          <p key={i} className="m-0 mt-2 first:mt-0">
            <Inline text={b.text} />
          </p>
        ),
      )}
    </>
  );
}

type Block = { kind: "p" | "quote"; text: string };

function splitBlocks(input: string): Block[] {
  const paragraphs = input.split(/\n{2,}/);
  return paragraphs
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p): Block => (p.startsWith("> ") ? { kind: "quote", text: p.slice(2) } : { kind: "p", text: p }));
}

function Inline({ text }: { text: string }) {
  const parts = tokenize(text);
  return (
    <>
      {parts.map((part, i) => {
        switch (part.kind) {
          case "code":
            return (
              <code
                key={i}
                className="rounded bg-white/[0.05] px-1.5 py-px font-mono text-[12px] text-fg"
              >
                {part.text}
              </code>
            );
          case "bold":
            return (
              <strong key={i} className="font-semibold text-fg">
                {part.text}
              </strong>
            );
          default:
            return <span key={i}>{part.text}</span>;
        }
      })}
    </>
  );
}

type Token = { kind: "text" | "code" | "bold"; text: string };

const TOKEN_RE = /(`[^`]+`|\*\*[^*]+\*\*)/g;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    const idx = match.index ?? 0;
    if (idx > last) tokens.push({ kind: "text", text: text.slice(last, idx) });
    const m = match[0];
    if (m.startsWith("`")) tokens.push({ kind: "code", text: m.slice(1, -1) });
    else tokens.push({ kind: "bold", text: m.slice(2, -2) });
    last = idx + m.length;
  }
  if (last < text.length) tokens.push({ kind: "text", text: text.slice(last) });
  return tokens;
}
