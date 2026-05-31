export type TokenViolation = { property: string; value: string };

const CORE_PROPS = ["color", "background-color", "font-family"] as const;

// Matches `prop: value;` declarations, capturing the value up to ; or }
const DECL = /(color|background-color|font-family)\s*:\s*([^;}]+)[;}]/gi;

export function findTokenViolations(html: string): TokenViolation[] {
  DECL.lastIndex = 0;
  const out: TokenViolation[] = [];
  let m: RegExpExecArray | null;
  while ((m = DECL.exec(html)) !== null) {
    const property = m[1].toLowerCase();
    const value = m[2].trim();
    if (!CORE_PROPS.includes(property as (typeof CORE_PROPS)[number])) continue;
    if (/var\(\s*--/.test(value)) continue; // uses a token — OK
    if (value === "inherit" || value === "transparent" || value === "currentColor") continue;
    out.push({ property, value });
  }
  return out;
}
