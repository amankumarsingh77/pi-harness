import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Type, type Static, type TSchema } from "typebox";

const DEFAULT_SEARXNG_URL = "http://localhost:8888";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESULTS = 8;
const MAX_FETCH_CHARS = 12_000;
const MAX_FETCH_BYTES = 1_000_000;

type ToolResult<T> = {
  content: { type: "text"; text: string }[];
  details: T;
  terminate?: boolean;
};

type ToolLike<TParams extends TSchema, TDetails> = {
  name: string;
  label: string;
  description: string;
  parameters: TParams;
  execute: (
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: never,
  ) => Promise<ToolResult<TDetails>>;
};

export type SearchResult = {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly source: string;
  readonly publishedAt?: string;
};

type SearXNGSearchSuccess = {
  readonly ok: true;
  readonly provider: "searxng";
  readonly providerUrl: string;
  readonly query: string;
  readonly results: ReadonlyArray<SearchResult>;
};

type SearXNGSearchFailure = {
  readonly ok: false;
  readonly provider: "searxng";
  readonly providerUrl: string;
  readonly query: string;
  readonly error: string;
  readonly code: WebResearchErrorCode;
};

type SearXNGFetchSuccess = {
  readonly ok: true;
  readonly url: string;
  readonly finalUrl: string;
  readonly title: string;
  readonly contentType: string;
  readonly fetchedAt: string;
  readonly text: string;
  readonly truncated: boolean;
};

type SearXNGFetchFailure = {
  readonly ok: false;
  readonly url: string;
  readonly error: string;
  readonly code: WebResearchErrorCode;
};

type WebResearchErrorCode =
  | "public_override_not_enabled"
  | "service_unavailable"
  | "timeout"
  | "empty_results"
  | "json_disabled_or_blocked"
  | "malformed_response"
  | "blocked_fetch"
  | "unsupported_content_type"
  | "oversized_response";

type SearXNGSearchDetails = SearXNGSearchSuccess | SearXNGSearchFailure;
type SearXNGFetchDetails = SearXNGFetchSuccess | SearXNGFetchFailure;

type Fetcher = (input: URL | string, init?: RequestInit) => Promise<Response>;

type SearxngProviderOptions = {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetcher?: Fetcher;
  readonly timeoutMs?: number;
};

type SearchInput = {
  readonly query: string;
  readonly domains?: ReadonlyArray<string>;
  readonly recencyDays?: number;
  readonly maxResults?: number;
};

type ProviderConfig = {
  readonly providerUrl: string;
  readonly allowPublic: boolean;
};

export class SearxngSearchProvider {
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly config: ProviderConfig;

  constructor(opts: SearxngProviderOptions = {}) {
    this.fetcher = opts.fetcher ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.config = readProviderConfig(opts.env ?? process.env);
  }

  async search(input: SearchInput): Promise<SearXNGSearchDetails> {
    const query = withDomainFilters(input.query, input.domains ?? []);
    const publicCheck = assertPublicAccess(this.config);
    if (publicCheck) {
      return failure({
        providerUrl: this.config.providerUrl,
        query,
        code: "public_override_not_enabled",
        error: publicCheck,
      });
    }

    const url = buildSearchUrl({
      providerUrl: this.config.providerUrl,
      query,
      ...(input.recencyDays !== undefined ? { recencyDays: input.recencyDays } : {}),
    });

    try {
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (response.status === 403) {
        return failure({
          providerUrl: this.config.providerUrl,
          query,
          code: "json_disabled_or_blocked",
          error: "SearXNG returned 403; JSON may be disabled or the instance blocked automation",
        });
      }
      if (!response.ok) {
        return failure({
          providerUrl: this.config.providerUrl,
          query,
          code: "service_unavailable",
          error: `SearXNG returned HTTP ${response.status}`,
        });
      }
      return normalizeSearchResponse({
        providerUrl: this.config.providerUrl,
        query,
        raw: await response.json(),
        maxResults: input.maxResults ?? DEFAULT_MAX_RESULTS,
      });
    } catch (err) {
      return failure({
        providerUrl: this.config.providerUrl,
        query,
        code: isTimeoutError(err) ? "timeout" : "service_unavailable",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

const SearXNGSearchParams = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 500 }),
  domains: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 8 })),
  recencyDays: Type.Optional(Type.Number({ minimum: 1, maximum: 3650 })),
  maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: 8 })),
});

const SearXNGFetchParams = Type.Object({
  url: Type.String({ minLength: 1, maxLength: 2000 }),
});

const WriteResearchFindingsParams = Type.Object({
  body: Type.String({ minLength: 1 }),
});

export function makeSearXNGSearchTool(opts: SearxngProviderOptions = {}): ToolLike<typeof SearXNGSearchParams, SearXNGSearchDetails> {
  return {
    name: "searxng_search",
    label: "Web search",
    description:
      "Search the web through the configured SearXNG instance. Use for external libraries, APIs, recent facts, pricing, and approach comparisons.",
    parameters: SearXNGSearchParams,
    async execute(_id, params) {
      const provider = new SearxngSearchProvider(opts);
      const details = await provider.search({
        query: params.query,
        ...(params.domains !== undefined ? { domains: params.domains } : {}),
        ...(params.recencyDays !== undefined ? { recencyDays: params.recencyDays } : {}),
        ...(params.maxResults !== undefined ? { maxResults: params.maxResults } : {}),
      });
      return {
        content: [{ type: "text", text: summarizeSearch(details) }],
        details,
      };
    },
  };
}

export function makeSearXNGFetchTool(opts: SearxngProviderOptions = {}): ToolLike<typeof SearXNGFetchParams, SearXNGFetchDetails> {
  const fetcher = opts.fetcher ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    name: "searxng_fetch",
    label: "Web fetch",
    description:
      "Fetch one search result URL and extract bounded readable text. Use only for pages selected from searxng_search results.",
    parameters: SearXNGFetchParams,
    async execute(_id, params) {
      const details = await fetchReadablePage({
        url: params.url,
        fetcher,
        timeoutMs,
      });
      return {
        content: [{ type: "text", text: summarizeFetch(details) }],
        details,
      };
    },
  };
}

export function makeWriteBrainstormResearchFindingsTool(deps: {
  cwd: string;
  taskId: string;
  subagent: string;
}): ToolLike<typeof WriteResearchFindingsParams, { ok: true; path: string }> & {
  __path: string;
  __subagent: string;
} {
  const path = join(
    deps.cwd,
    ".harness",
    deps.taskId,
    "brainstorm-research",
    `${deps.subagent}.md`,
  );
  return {
    name: "write_findings",
    label: "Write findings",
    description:
      "Persist your research findings document. The path is fixed by the harness; call this exactly once when done.",
    parameters: WriteResearchFindingsParams,
    async execute(_id, params) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, params.body, "utf8");
      return {
        content: [{ type: "text", text: `wrote ${path}` }],
        details: { ok: true, path },
      };
    },
    __path: path,
    __subagent: deps.subagent,
  };
}

export function shouldRunWebResearch(input: {
  readonly title?: string;
  readonly description?: string;
}): boolean {
  const text = `${input.title ?? ""}\n${input.description ?? ""}`.toLowerCase();
  const patterns = [
    /\blibrar(?:y|ies)\b/,
    /\bapi\b/,
    /\bframework\b/,
    /\bsdk\b/,
    /\bpackage\b/,
    /\bnpm\b/,
    /\blatest\b/,
    /\bcurrent\b/,
    /\bpricing\b/,
    /\balternative/,
    /\bintegration/,
    /\bcompare\b/,
    /\bapproach(?:es)?\b/,
    /\bresearch\b/,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

export function brainstormResearchPath(cwd: string, taskId: string): string {
  return join(cwd, ".harness", taskId, "brainstorm-research", "web-search-researcher.md");
}

function readProviderConfig(env: NodeJS.ProcessEnv): ProviderConfig {
  return {
    providerUrl: normalizeBaseUrl(env["SEARXNG_URL"] ?? DEFAULT_SEARXNG_URL),
    allowPublic: env["SEARXNG_ALLOW_PUBLIC"] === "true",
  };
}

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

function assertPublicAccess(config: ProviderConfig): string | null {
  if (config.allowPublic) return null;
  const parsed = parseUrl(config.providerUrl);
  if (!parsed) return `Invalid SEARXNG_URL: ${config.providerUrl}`;
  if (isPrivateHost(parsed.hostname)) return null;
  return "SEARXNG_URL points to a public host; set SEARXNG_ALLOW_PUBLIC=true to use a manual public override";
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  if (host.startsWith("127.")) return true;
  if (host.startsWith("10.")) return true;
  if (host.startsWith("192.168.")) return true;
  const [first, second] = host.split(".").map((part) => Number(part));
  return first === 172 && second !== undefined && second >= 16 && second <= 31;
}

function withDomainFilters(query: string, domains: ReadonlyArray<string>): string {
  if (domains.length === 0) return query;
  const filters = domains.map((domain) => `site:${domain}`).join(" OR ");
  return `${query} (${filters})`;
}

function buildSearchUrl(input: {
  readonly providerUrl: string;
  readonly query: string;
  readonly recencyDays?: number;
}): URL {
  const url = new URL("/search", input.providerUrl);
  url.searchParams.set("q", input.query);
  url.searchParams.set("format", "json");
  if (input.recencyDays !== undefined) {
    url.searchParams.set("time_range", recencyToSearxng(input.recencyDays));
  }
  return url;
}

function recencyToSearxng(days: number): string {
  if (days <= 1) return "day";
  if (days <= 31) return "month";
  return "year";
}

function normalizeSearchResponse(input: {
  readonly providerUrl: string;
  readonly query: string;
  readonly raw: unknown;
  readonly maxResults: number;
}): SearXNGSearchDetails {
  if (!isObject(input.raw)) {
    return failure({
      providerUrl: input.providerUrl,
      query: input.query,
      code: "malformed_response",
      error: "SearXNG returned a non-object JSON response",
    });
  }
  const rawResults = input.raw["results"];
  if (!Array.isArray(rawResults)) {
    return failure({
      providerUrl: input.providerUrl,
      query: input.query,
      code: "malformed_response",
      error: "SearXNG response did not include a results array",
    });
  }
  const results = rawResults
    .map(toSearchResult)
    .filter((result): result is SearchResult => result !== null)
    .slice(0, input.maxResults);
  if (results.length === 0) {
    return failure({
      providerUrl: input.providerUrl,
      query: input.query,
      code: "empty_results",
      error: "SearXNG returned no usable results",
    });
  }
  return {
    ok: true,
    provider: "searxng",
    providerUrl: input.providerUrl,
    query: input.query,
    results,
  };
}

function toSearchResult(value: unknown): SearchResult | null {
  if (!isObject(value)) return null;
  const title = stringValue(value["title"]);
  const url = stringValue(value["url"]);
  if (!title || !url) return null;
  const snippet = stringValue(value["content"]) ?? stringValue(value["snippet"]) ?? "";
  const source = stringValue(value["engine"]) ?? stringValue(value["source"]) ?? "searxng";
  const publishedAt = stringValue(value["publishedDate"]) ?? stringValue(value["published_at"]);
  return {
    title,
    url,
    snippet,
    source,
    ...(publishedAt !== undefined ? { publishedAt } : {}),
  };
}

function failure(input: {
  readonly providerUrl: string;
  readonly query: string;
  readonly error: string;
  readonly code: WebResearchErrorCode;
}): SearXNGSearchFailure {
  return {
    ok: false,
    provider: "searxng",
    providerUrl: input.providerUrl,
    query: input.query,
    code: input.code,
    error: input.error,
  };
}

async function fetchReadablePage(input: {
  readonly url: string;
  readonly fetcher: Fetcher;
  readonly timeoutMs: number;
}): Promise<SearXNGFetchDetails> {
  const parsed = parseUrl(input.url);
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return { ok: false, url: input.url, code: "blocked_fetch", error: "Only http/https URLs can be fetched" };
  }
  try {
    const response = await input.fetcher(parsed, { signal: AbortSignal.timeout(input.timeoutMs) });
    if (!response.ok) {
      return { ok: false, url: input.url, code: "blocked_fetch", error: `Fetch returned HTTP ${response.status}` };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!isSupportedContentType(contentType)) {
      return {
        ok: false,
        url: input.url,
        code: "unsupported_content_type",
        error: `Unsupported content type: ${contentType || "unknown"}`,
      };
    }
    const body = await response.text();
    if (body.length > MAX_FETCH_BYTES) {
      return { ok: false, url: input.url, code: "oversized_response", error: "Fetched page exceeded size limit" };
    }
    const extracted = extractReadableText(body, contentType);
    return {
      ok: true,
      url: input.url,
      finalUrl: response.url || input.url,
      title: extracted.title,
      contentType,
      fetchedAt: new Date().toISOString(),
      text: extracted.text.slice(0, MAX_FETCH_CHARS),
      truncated: extracted.text.length > MAX_FETCH_CHARS,
    };
  } catch (err) {
    return {
      ok: false,
      url: input.url,
      code: isTimeoutError(err) ? "timeout" : "blocked_fetch",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function isSupportedContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return lower.includes("text/html") || lower.includes("text/plain");
}

function extractReadableText(body: string, contentType: string): { readonly title: string; readonly text: string } {
  if (contentType.toLowerCase().includes("text/plain")) {
    return { title: "", text: normalizeWhitespace(body) };
  }
  const title = decodeEntities(matchFirst(body, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? "");
  const withoutNoise = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const text = decodeEntities(withoutNoise.replace(/<[^>]+>/g, " "));
  return { title: normalizeWhitespace(title), text: normalizeWhitespace(text) };
}

function matchFirst(value: string, pattern: RegExp): string | null {
  const match = pattern.exec(value);
  return match?.[1] ?? null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function summarizeSearch(details: SearXNGSearchDetails): string {
  if (!details.ok) return `searxng_search failed: ${details.error}`;
  const lines = details.results.map((result, index) => `${index + 1}. ${result.title} — ${result.url}`);
  return [`${details.results.length} result(s) from ${details.providerUrl}`, ...lines].join("\n");
}

function summarizeFetch(details: SearXNGFetchDetails): string {
  if (!details.ok) return `searxng_fetch failed: ${details.error}`;
  return [`Fetched ${details.finalUrl}`, details.title, details.text].filter(Boolean).join("\n\n");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}
