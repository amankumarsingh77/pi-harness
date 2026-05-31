// STUB (UI-first). Replace the body with a pi agent step in a later phase;
// keep this signature so callers and the confirm-modal contract are stable.
import type { TokenChange, TokenDiff } from "./design-system-types.js";

const HEX = /(color|background-color)\s*:\s*(#[0-9a-fA-F]{3,8})/g;

export function distillTokensStub(input: {
  mockHtml: string;
  currentTokensCss: string;
  fromVersion: number;
  title: string;
}): TokenDiff {
  HEX.lastIndex = 0;
  const changes: TokenChange[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = HEX.exec(input.mockHtml)) !== null) {
    const propName = m[1];
    const after = m[2];
    if (propName === undefined || after === undefined) continue;
    const name = propName === "color" ? "--fg" : "--bg";
    if (seen.has(name)) continue;
    seen.add(name);
    const before =
      new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(input.currentTokensCss)?.[1]?.trim() ?? null;
    changes.push({ name, before, after });
  }
  return {
    fromVersion: input.fromVersion,
    toVersion: input.fromVersion + 1,
    summary: `Promote "${input.title}" (stub distill)`,
    changes,
    designMdDelta: `## ${input.title}\nPromoted as exemplar (stub distill).`,
  };
}
