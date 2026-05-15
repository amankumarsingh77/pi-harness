import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Type, type Static, type TSchema } from "typebox";

const DEFAULT_WEB_PROVIDER: WebResearchProvider = "tinyfish";
const DEFAULT_TINYFISH_SEARCH_URL = "https://api.search.tinyfish.ai";
const DEFAULT_TINYFISH_FETCH_URL = "https://api.fetch.tinyfish.ai";
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

export type WebResearchProvider = "tinyfish" | "searxng";

export type SearchResult = {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly source: string;
  readonly publishedAt?: string;
};

type WebSearchSuccess = {
  readonly ok: true;
  readonly provider: WebResearchProvider;
  readonly providerUrl?: string;
  readonly query: string;
  readonly results: ReadonlyArray<SearchResult>;
};

type WebSearchFailure = {
  readonly ok: false;
  readonly provider?: WebResearchProvider;
  readonly providerUrl?: string;
  readonly query: string;
  readonly error: string;
  readonly code: WebResearchErrorCode;
};

type WebFetchSuccess = {
  readonly ok: true;
  readonly provider: WebResearchProvider;
  readonly url: string;
  readonly finalUrl: string;
  readonly title: string;
  readonly contentType: string;
  readonly fetchedAt: string;
  readonly text: string;
  readonly truncated: boolean;
};

type WebFetchFailure = {
  readonly ok: false;
  readonly provider?: WebResearchProvider;
  readonly url: string;
  readonly error: string;
  readonly code: WebResearchErrorCode;
};

type WebResearchErrorCode =
  | "missing_api_key"
  | "invalid_provider"
  | "unauthorized"
  | "payment_required"
  | "rate_limited"
  | "provider_unavailable"
  | "public_override_not_enabled"
  | "service_unavailable"
  | "timeout"
  | "empty_results"
  | "json_disabled_or_blocked"
  | "malformed_response"
  | "blocked_fetch"
  | "unsupported_content_type"
  | "oversized_response";

type WebSearchDetails = WebSearchSuccess | WebSearchFailure;
type WebFetchDetails = WebFetchSuccess | WebFetchFailure;

type Fetcher = (input: URL | string, init?: RequestInit) => Promise<Response>;

type WebResearchProviderOptions = {
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

type FetchInput = {
  readonly url: string;
};

type TinyFishConfig = {
  readonly provider: "tinyfish";
  readonly apiKey?: string;
  readonly searchUrl: string;
  readonly fetchUrl: string;
};

type SearxngConfig = {
  readonly provider: "searxng";
  readonly providerUrl: string;
  readonly allowPublic: boolean;
};

type InvalidProviderConfig = {
  readonly provider?: undefined;
  readonly error: string;
};

type WebProviderConfig = TinyFishConfig | SearxngConfig | InvalidProviderConfig;

export class PiWebResearchProvider {
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly config: WebProviderConfig;

  constructor(opts: WebResearchProviderOptions = {}) {
    this.fetcher = opts.fetcher ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.config = readWebProviderConfig(opts.env ?? process.env);
  }

  async search(input: SearchInput): Promise<WebSearchDetails> {
    const query = withDomainFilters(input.query, input.domains ?? []);
    if (!isValidConfig(this.config)) {
      return {
        ok: false,
        query,
        code: "invalid_provider",
        error: this.config.error,
      };
    }
    if (this.config.provider === "searxng") {
      return new SearxngSearchProvider({
        fetcher: this.fetcher,
        timeoutMs: this.timeoutMs,
        env: {
          SEARXNG_URL: this.config.providerUrl,
          SEARXNG_ALLOW_PUBLIC: String(this.config.allowPublic),
        },
      }).search({ ...input, query });
    }
    return searchTinyFish({
      config: this.config,
      fetcher: this.fetcher,
      timeoutMs: this.timeoutMs,
      query,
      maxResults: input.maxResults ?? DEFAULT_MAX_RESULTS,
    });
  }

  async fetch(input: FetchInput): Promise<WebFetchDetails> {
    if (!isValidConfig(this.config)) {
      return {
        ok: false,
        url: input.url,
        code: "invalid_provider",
        error: this.config.error,
      };
    }
    if (this.config.provider === "searxng") {
      return fetchReadablePage({
        url: input.url,
        provider: "searxng",
        fetcher: this.fetcher,
        timeoutMs: this.timeoutMs,
      });
    }
    return fetchTinyFish({
      config: this.config,
      fetcher: this.fetcher,
      timeoutMs: this.timeoutMs,
      url: input.url,
    });
  }
}

export class SearxngSearchProvider {
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly config: SearxngConfig;

  constructor(opts: WebResearchProviderOptions = {}) {
    this.fetcher = opts.fetcher ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.config = readSearxngConfig(opts.env ?? process.env);
  }

  async search(input: SearchInput): Promise<WebSearchDetails> {
    const query = withDomainFilters(input.query, input.domains ?? []);
    const publicCheck = assertPublicAccess(this.config);
    if (publicCheck) {
      return searchFailure({
        provider: "searxng",
        providerUrl: this.config.providerUrl,
        query,
        code: "public_override_not_enabled",
        error: publicCheck,
      });
    }

    const url = buildSearxngSearchUrl({
      providerUrl: this.config.providerUrl,
      query,
      ...(input.recencyDays !== undefined ? { recencyDays: input.recencyDays } : {}),
    });

    try {
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (response.status === 403) {
        return searchFailure({
          provider: "searxng",
          providerUrl: this.config.providerUrl,
          query,
          code: "json_disabled_or_blocked",
          error: "SearXNG returned 403; JSON may be disabled or the instance blocked automation",
        });
      }
      if (!response.ok) {
        return searchFailure({
          provider: "searxng",
          providerUrl: this.config.providerUrl,
          query,
          code: "service_unavailable",
          error: `SearXNG returned HTTP ${response.status}`,
        });
      }
      const raw = await readJson(response);
      if (!raw.ok) {
        return searchFailure({
          provider: "searxng",
          providerUrl: this.config.providerUrl,
          query,
          code: "malformed_response",
          error: raw.error,
        });
      }
      return normalizeSearxngSearchResponse({
        providerUrl: this.config.providerUrl,
        query,
        raw: raw.value,
        maxResults: input.maxResults ?? DEFAULT_MAX_RESULTS,
      });
    } catch (err) {
      return searchFailure({
        provider: "searxng",
        providerUrl: this.config.providerUrl,
        query,
        code: isTimeoutError(err) ? "timeout" : "service_unavailable",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

const PiWebSearchParams = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 500 }),
  domains: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 8 })),
  recencyDays: Type.Optional(Type.Number({ minimum: 1, maximum: 3650 })),
  maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: 8 })),
});

const PiWebFetchParams = Type.Object({
  url: Type.String({ minLength: 1, maxLength: 2000 }),
});

const WriteResearchFindingsParams = Type.Object({
  body: Type.String({ minLength: 1 }),
});

export function makePiWebSearchTool(opts: WebResearchProviderOptions = {}): ToolLike<typeof PiWebSearchParams, WebSearchDetails> {
  return {
    name: "pi_web_search",
    label: "Web search",
    description:
      "Search the web through the configured pi-harness web research provider. Use for external libraries, APIs, recent facts, pricing, and approach comparisons.",
    parameters: PiWebSearchParams,
    async execute(_id, params) {
      const provider = new PiWebResearchProvider(opts);
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

export function makePiWebFetchTool(opts: WebResearchProviderOptions = {}): ToolLike<typeof PiWebFetchParams, WebFetchDetails> {
  return {
    name: "pi_web_fetch",
    label: "Web fetch",
    description:
      "Fetch one search result URL and extract bounded readable text. Use only for pages selected from pi_web_search results.",
    parameters: PiWebFetchParams,
    async execute(_id, params) {
      const provider = new PiWebResearchProvider(opts);
      const details = await provider.fetch({ url: params.url });
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

function readWebProviderConfig(env: NodeJS.ProcessEnv): WebProviderConfig {
  const provider = env["PI_WEB_PROVIDER"] ?? DEFAULT_WEB_PROVIDER;
  if (provider === "tinyfish") {
    const apiKey = stringValue(env["TINYFISH_API_KEY"]);
    return {
      provider,
      ...(apiKey !== undefined ? { apiKey } : {}),
      searchUrl: normalizeBaseUrl(env["TINYFISH_SEARCH_URL"] ?? DEFAULT_TINYFISH_SEARCH_URL),
      fetchUrl: normalizeBaseUrl(env["TINYFISH_FETCH_URL"] ?? DEFAULT_TINYFISH_FETCH_URL),
    };
  }
  if (provider === "searxng") return readSearxngConfig(env);
  return {
    error: `Invalid PI_WEB_PROVIDER: ${provider}`,
  };
}

function readSearxngConfig(env: NodeJS.ProcessEnv): SearxngConfig {
  return {
    provider: "searxng",
    providerUrl: normalizeBaseUrl(env["SEARXNG_URL"] ?? DEFAULT_SEARXNG_URL),
    allowPublic: env["SEARXNG_ALLOW_PUBLIC"] === "true",
  };
}

function isValidConfig(config: WebProviderConfig): config is TinyFishConfig | SearxngConfig {
  return config.provider === "tinyfish" || config.provider === "searxng";
}

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

function assertPublicAccess(config: SearxngConfig): string | null {
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

function buildSearxngSearchUrl(input: {
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

async function searchTinyFish(input: {
  readonly config: TinyFishConfig;
  readonly fetcher: Fetcher;
  readonly timeoutMs: number;
  readonly query: string;
  readonly maxResults: number;
}): Promise<WebSearchDetails> {
  if (!input.config.apiKey) {
    return searchFailure({
      provider: "tinyfish",
      query: input.query,
      code: "missing_api_key",
      error: "TINYFISH_API_KEY is required when PI_WEB_PROVIDER=tinyfish",
    });
  }
  const url = new URL(input.config.searchUrl);
  url.searchParams.set("query", input.query);
  url.searchParams.set("location", "US");
  url.searchParams.set("language", "en");
  url.searchParams.set("page", "0");

  try {
    const response = await input.fetcher(url, {
      headers: { "X-API-Key": input.config.apiKey },
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    if (!response.ok) {
      return searchFailure({
        provider: "tinyfish",
        query: input.query,
        code: tinyFishHttpErrorCode(response.status),
        error: `TinyFish search returned HTTP ${response.status}`,
      });
    }
    const raw = await readJson(response);
    if (!raw.ok) {
      return searchFailure({
        provider: "tinyfish",
        query: input.query,
        code: "malformed_response",
        error: raw.error,
      });
    }
    return normalizeTinyFishSearchResponse({
      query: input.query,
      raw: raw.value,
      maxResults: input.maxResults,
    });
  } catch (err) {
    return searchFailure({
      provider: "tinyfish",
      query: input.query,
      code: isTimeoutError(err) ? "timeout" : "provider_unavailable",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function fetchTinyFish(input: {
  readonly config: TinyFishConfig;
  readonly fetcher: Fetcher;
  readonly timeoutMs: number;
  readonly url: string;
}): Promise<WebFetchDetails> {
  if (!input.config.apiKey) {
    return fetchFailure({
      provider: "tinyfish",
      url: input.url,
      code: "missing_api_key",
      error: "TINYFISH_API_KEY is required when PI_WEB_PROVIDER=tinyfish",
    });
  }
  try {
    const response = await input.fetcher(input.config.fetchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": input.config.apiKey,
      },
      body: JSON.stringify({
        urls: [input.url],
        format: "markdown",
        links: false,
        image_links: false,
      }),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    if (!response.ok) {
      return fetchFailure({
        provider: "tinyfish",
        url: input.url,
        code: tinyFishHttpErrorCode(response.status),
        error: `TinyFish fetch returned HTTP ${response.status}`,
      });
    }
    const raw = await readJson(response);
    if (!raw.ok) {
      return fetchFailure({
        provider: "tinyfish",
        url: input.url,
        code: "malformed_response",
        error: raw.error,
      });
    }
    return normalizeTinyFishFetchResponse({
      url: input.url,
      raw: raw.value,
    });
  } catch (err) {
    return fetchFailure({
      provider: "tinyfish",
      url: input.url,
      code: isTimeoutError(err) ? "timeout" : "provider_unavailable",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function tinyFishHttpErrorCode(status: number): WebResearchErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 402) return "payment_required";
  if (status === 429) return "rate_limited";
  if (status === 500 || status === 503 || status === 404) return "provider_unavailable";
  return "service_unavailable";
}

function normalizeTinyFishSearchResponse(input: {
  readonly query: string;
  readonly raw: unknown;
  readonly maxResults: number;
}): WebSearchDetails {
  if (!isObject(input.raw)) {
    return searchFailure({
      provider: "tinyfish",
      query: input.query,
      code: "malformed_response",
      error: "TinyFish search returned a non-object JSON response",
    });
  }
  const rawResults = input.raw["results"];
  if (!Array.isArray(rawResults)) {
    return searchFailure({
      provider: "tinyfish",
      query: input.query,
      code: "malformed_response",
      error: "TinyFish search response did not include a results array",
    });
  }
  const results = rawResults
    .map(toTinyFishSearchResult)
    .filter((result): result is SearchResult => result !== null)
    .slice(0, input.maxResults);
  if (results.length === 0) {
    return searchFailure({
      provider: "tinyfish",
      query: input.query,
      code: "empty_results",
      error: "TinyFish search returned no usable results",
    });
  }
  return {
    ok: true,
    provider: "tinyfish",
    query: input.query,
    results,
  };
}

function normalizeSearxngSearchResponse(input: {
  readonly providerUrl: string;
  readonly query: string;
  readonly raw: unknown;
  readonly maxResults: number;
}): WebSearchDetails {
  if (!isObject(input.raw)) {
    return searchFailure({
      provider: "searxng",
      providerUrl: input.providerUrl,
      query: input.query,
      code: "malformed_response",
      error: "SearXNG returned a non-object JSON response",
    });
  }
  const rawResults = input.raw["results"];
  if (!Array.isArray(rawResults)) {
    return searchFailure({
      provider: "searxng",
      providerUrl: input.providerUrl,
      query: input.query,
      code: "malformed_response",
      error: "SearXNG response did not include a results array",
    });
  }
  const results = rawResults
    .map(toSearxngSearchResult)
    .filter((result): result is SearchResult => result !== null)
    .slice(0, input.maxResults);
  if (results.length === 0) {
    return searchFailure({
      provider: "searxng",
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

function toTinyFishSearchResult(value: unknown): SearchResult | null {
  if (!isObject(value)) return null;
  const title = stringValue(value["title"]);
  const url = stringValue(value["url"]);
  if (!title || !url) return null;
  return {
    title,
    url,
    snippet: stringValue(value["snippet"]) ?? "",
    source: stringValue(value["site_name"]) ?? "tinyfish",
  };
}

function toSearxngSearchResult(value: unknown): SearchResult | null {
  if (!isObject(value)) return null;
  const title = stringValue(value["title"]);
  const url = stringValue(value["url"]);
  if (!title || !url) return null;
  const publishedAt = stringValue(value["publishedDate"]) ?? stringValue(value["published_at"]);
  return {
    title,
    url,
    snippet: stringValue(value["content"]) ?? stringValue(value["snippet"]) ?? "",
    source: stringValue(value["engine"]) ?? stringValue(value["source"]) ?? "searxng",
    ...(publishedAt !== undefined ? { publishedAt } : {}),
  };
}

function normalizeTinyFishFetchResponse(input: {
  readonly url: string;
  readonly raw: unknown;
}): WebFetchDetails {
  if (!isObject(input.raw)) {
    return fetchFailure({
      provider: "tinyfish",
      url: input.url,
      code: "malformed_response",
      error: "TinyFish fetch returned a non-object JSON response",
    });
  }
  const rawResults = input.raw["results"];
  const rawErrors = input.raw["errors"];
  if (!Array.isArray(rawResults) || !Array.isArray(rawErrors)) {
    return fetchFailure({
      provider: "tinyfish",
      url: input.url,
      code: "malformed_response",
      error: "TinyFish fetch response did not include results and errors arrays",
    });
  }
  const result = rawResults.map(toTinyFishFetchResult).find((item): item is WebFetchSuccess => item !== null);
  if (result) return result;

  const error = rawErrors.map(toTinyFishFetchError).find((item): item is WebFetchFailure => item !== null);
  if (error) return error;

  return fetchFailure({
    provider: "tinyfish",
    url: input.url,
    code: "empty_results",
    error: "TinyFish fetch returned no usable result",
  });
}

function toTinyFishFetchResult(value: unknown): WebFetchSuccess | null {
  if (!isObject(value)) return null;
  const url = stringValue(value["url"]);
  const text = stringValue(value["text"]);
  if (!url || text === undefined) return null;
  const finalUrl = stringValue(value["final_url"]) ?? url;
  const format = stringValue(value["format"]) ?? "markdown";
  return {
    ok: true,
    provider: "tinyfish",
    url,
    finalUrl,
    title: stringValue(value["title"]) ?? "",
    contentType: format === "markdown" ? "text/markdown" : `application/${format}`,
    fetchedAt: new Date().toISOString(),
    text: text.slice(0, MAX_FETCH_CHARS),
    truncated: text.length > MAX_FETCH_CHARS,
  };
}

function toTinyFishFetchError(value: unknown): WebFetchFailure | null {
  if (!isObject(value)) return null;
  const url = stringValue(value["url"]);
  const error = stringValue(value["error"]);
  if (!url || !error) return null;
  return fetchFailure({
    provider: "tinyfish",
    url,
    code: tinyFishFetchErrorCode(error),
    error: `TinyFish fetch failed: ${error}`,
  });
}

function tinyFishFetchErrorCode(error: string): WebResearchErrorCode {
  if (error === "timeout") return "timeout";
  if (error === "empty_content") return "empty_results";
  return "blocked_fetch";
}

function searchFailure(input: {
  readonly provider?: WebResearchProvider;
  readonly providerUrl?: string;
  readonly query: string;
  readonly error: string;
  readonly code: WebResearchErrorCode;
}): WebSearchFailure {
  return {
    ok: false,
    ...(input.provider !== undefined ? { provider: input.provider } : {}),
    ...(input.providerUrl !== undefined ? { providerUrl: input.providerUrl } : {}),
    query: input.query,
    code: input.code,
    error: input.error,
  };
}

function fetchFailure(input: {
  readonly provider?: WebResearchProvider;
  readonly url: string;
  readonly error: string;
  readonly code: WebResearchErrorCode;
}): WebFetchFailure {
  return {
    ok: false,
    ...(input.provider !== undefined ? { provider: input.provider } : {}),
    url: input.url,
    code: input.code,
    error: input.error,
  };
}

async function fetchReadablePage(input: {
  readonly url: string;
  readonly provider: WebResearchProvider;
  readonly fetcher: Fetcher;
  readonly timeoutMs: number;
}): Promise<WebFetchDetails> {
  const parsed = parseUrl(input.url);
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return fetchFailure({
      provider: input.provider,
      url: input.url,
      code: "blocked_fetch",
      error: "Only http/https URLs can be fetched",
    });
  }
  try {
    const response = await input.fetcher(parsed, { signal: AbortSignal.timeout(input.timeoutMs) });
    if (!response.ok) {
      return fetchFailure({
        provider: input.provider,
        url: input.url,
        code: "blocked_fetch",
        error: `Fetch returned HTTP ${response.status}`,
      });
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!isSupportedContentType(contentType)) {
      return fetchFailure({
        provider: input.provider,
        url: input.url,
        code: "unsupported_content_type",
        error: `Unsupported content type: ${contentType || "unknown"}`,
      });
    }
    const body = await response.text();
    if (body.length > MAX_FETCH_BYTES) {
      return fetchFailure({
        provider: input.provider,
        url: input.url,
        code: "oversized_response",
        error: "Fetched page exceeded size limit",
      });
    }
    const extracted = extractReadableText(body, contentType);
    return {
      ok: true,
      provider: input.provider,
      url: input.url,
      finalUrl: response.url || input.url,
      title: extracted.title,
      contentType,
      fetchedAt: new Date().toISOString(),
      text: extracted.text.slice(0, MAX_FETCH_CHARS),
      truncated: extracted.text.length > MAX_FETCH_CHARS,
    };
  } catch (err) {
    return fetchFailure({
      provider: input.provider,
      url: input.url,
      code: isTimeoutError(err) ? "timeout" : "blocked_fetch",
      error: err instanceof Error ? err.message : String(err),
    });
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

function summarizeSearch(details: WebSearchDetails): string {
  if (!details.ok) return `pi_web_search failed: ${details.error}`;
  const lines = details.results.map((result, index) => `${index + 1}. ${result.title} — ${result.url}`);
  return [`${details.results.length} result(s) from ${details.provider}`, ...lines].join("\n");
}

function summarizeFetch(details: WebFetchDetails): string {
  if (!details.ok) return `pi_web_fetch failed: ${details.error}`;
  return [`Fetched ${details.finalUrl}`, details.title, details.text].filter(Boolean).join("\n\n");
}

async function readJson(response: Response): Promise<
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string }
> {
  try {
    return { ok: true, value: await response.json() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
