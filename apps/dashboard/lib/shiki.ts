import {
  createHighlighter,
  type Highlighter,
  type BundledLanguage,
} from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// Syntax highlighting for artifact code blocks and the YAML viewer.
//
// One singleton highlighter, created lazily on first use and shared across every
// CodeBlock. We load only the languages that actually appear in plan artifacts plus
// one dark theme, and use the JavaScript regex engine so no Oniguruma WASM is shipped.

const THEME = "github-dark";

// Languages that show up in plan.md / phase plans / yaml artifacts. Anything outside
// this set is rendered as plain text (see normalizeLang). NB: `dot`/`graphviz` are not
// in Shiki's bundle, so Phase-DAG blocks fall back to clean plaintext (label still shown).
const LANGS = [
  "yaml",
  "json",
  "typescript",
  "tsx",
  "javascript",
  "bash",
  "markdown",
  "diff",
] as const satisfies readonly BundledLanguage[];

const SUPPORTED = new Set<string>(LANGS);

const ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  md: "markdown",
};

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: [THEME],
    langs: [...LANGS],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

// Map fence languages to a grammar we loaded, falling back to plaintext.
export function normalizeLang(lang: string): string {
  const lower = lang.trim().toLowerCase();
  const resolved = ALIASES[lower] ?? lower;
  return SUPPORTED.has(resolved) ? resolved : "text";
}

// Highlight `code` to an HTML string. The returned markup is Shiki's own escaped,
// trusted output (no user HTML is interpreted), safe for dangerouslySetInnerHTML.
export async function highlightToHtml(code: string, lang: string): Promise<string> {
  const resolved = normalizeLang(lang);
  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(code, {
    lang: resolved,
    theme: THEME,
  });
}
