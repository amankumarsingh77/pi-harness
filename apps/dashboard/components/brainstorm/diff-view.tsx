"use client";

// Line-level diff between two strings. Each part is one line plus its
// classification: "add" (only in `current`), "remove" (only in `baseline`),
// or "equal" (in both, in the same logical position).
//
// Why hand-rolled instead of jsdiff: artifacts are short (<200 lines).
// Adding a runtime dependency for one component isn't worth it. The
// implementation is a standard LCS-via-DP backtrace.
export type DiffPart =
  | { kind: "add"; line: string }
  | { kind: "remove"; line: string }
  | { kind: "equal"; line: string };

export function diffLines(baseline: string, current: string): DiffPart[] {
  const a = baseline.split("\n");
  const b = current.split("\n");
  const m = a.length;
  const n = b.length;
  // Build LCS length table.
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0) as number[]);
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        dp[i]![j] = (dp[i + 1]![j + 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
      }
    }
  }
  const out: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: "equal", line: a[i]! });
      i += 1;
      j += 1;
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      out.push({ kind: "remove", line: a[i]! });
      i += 1;
    } else {
      out.push({ kind: "add", line: b[j]! });
      j += 1;
    }
  }
  while (i < m) {
    out.push({ kind: "remove", line: a[i]! });
    i += 1;
  }
  while (j < n) {
    out.push({ kind: "add", line: b[j]! });
    j += 1;
  }
  return out;
}

export function DiffView({
  baseline,
  current,
}: {
  baseline: string;
  current: string;
}) {
  const parts = diffLines(baseline, current);
  return (
    <pre
      className="scroll-hide markdown-body min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words px-6 py-3.5 font-mono text-[12px] leading-[1.55]"
      data-testid="diff-view"
    >
      {parts.map((p, i) => (
        <div
          key={i}
          className={
            p.kind === "add"
              ? "bg-st-done/10 text-fg-body"
              : p.kind === "remove"
                ? "bg-st-blocked/10 text-fg-mute line-through"
                : "text-fg-subtle"
          }
        >
          <span className="select-none pr-2 text-fg-faint">
            {p.kind === "add" ? "+" : p.kind === "remove" ? "-" : " "}
          </span>
          {p.line || " "}
        </div>
      ))}
    </pre>
  );
}
