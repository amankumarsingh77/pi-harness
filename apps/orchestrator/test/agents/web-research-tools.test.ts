import { describe, expect, it, vi } from "vitest";
import {
  makePiWebFetchTool,
  makePiWebSearchTool,
  PiWebResearchProvider,
  SearxngSearchProvider,
  shouldRunWebResearch,
} from "../../src/agents/web-research-tools.js";

describe("PiWebResearchProvider", () => {
  it("defaults to TinyFish and fails clearly without an API key", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const provider = new PiWebResearchProvider({ fetcher, env: {} });

    const result = await provider.search({ query: "vitest" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.provider).toBe("tinyfish");
      expect(result.code).toBe("missing_api_key");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects unknown provider values", async () => {
    const provider = new PiWebResearchProvider({
      env: { PI_WEB_PROVIDER: "unknown", TINYFISH_API_KEY: "tf-key" },
    });

    const result = await provider.search({ query: "vitest" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_provider");
    }
  });

  it("uses SearXNG when explicitly configured", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ title: "A", url: "https://a.test" }] }), {
        status: 200,
      }),
    );
    const provider = new PiWebResearchProvider({
      fetcher,
      env: { PI_WEB_PROVIDER: "searxng" },
    });

    const result = await provider.search({ query: "x" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe("searxng");
    }
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("http://localhost:8888/search");
  });

  it("searches TinyFish with API key and normalized results", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          query: "vitest",
          results: [
            {
              title: "Vitest",
              url: "https://vitest.dev",
              snippet: "Fast testing framework",
              site_name: "vitest.dev",
            },
          ],
          total_results: 1,
          page: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new PiWebResearchProvider({
      fetcher,
      env: { TINYFISH_API_KEY: "tf-key" },
    });

    const result = await provider.search({
      query: "vitest",
      domains: ["vitest.dev"],
      recencyDays: 7,
      maxResults: 1,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe("tinyfish");
      expect(result.query).toBe("vitest (site:vitest.dev)");
      expect(result.results[0]).toEqual({
        title: "Vitest",
        url: "https://vitest.dev",
        snippet: "Fast testing framework",
        source: "vitest.dev",
      });
    }
    const requestUrl = fetcher.mock.calls[0]?.[0];
    const requestInit = fetcher.mock.calls[0]?.[1];
    expect(String(requestUrl)).toContain("https://api.search.tinyfish.ai/");
    expect(String(requestUrl)).toContain("query=vitest+%28site%3Avitest.dev%29");
    expect(String(requestUrl)).toContain("location=US");
    expect(String(requestUrl)).toContain("language=en");
    expect(String(requestUrl)).toContain("page=0");
    expect(String(requestUrl)).not.toContain("recency");
    expect(String(requestUrl)).not.toContain("time_range");
    expect(requestInit?.headers).toEqual({ "X-API-Key": "tf-key" });
  });

  it.each([
    [401, "unauthorized"],
    [402, "payment_required"],
    [429, "rate_limited"],
    [500, "provider_unavailable"],
  ] as const)("maps TinyFish search HTTP %s", async (status, code) => {
    const provider = new PiWebResearchProvider({
      fetcher: async () => new Response("error", { status }),
      env: { TINYFISH_API_KEY: "tf-key" },
    });

    const result = await provider.search({ query: "x" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(code);
    }
  });

  it("maps malformed TinyFish search responses", async () => {
    const provider = new PiWebResearchProvider({
      fetcher: async () => new Response(JSON.stringify({ nope: [] }), { status: 200 }),
      env: { TINYFISH_API_KEY: "tf-key" },
    });

    const result = await provider.search({ query: "x" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("malformed_response");
    }
  });

  it("fetches TinyFish markdown content", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              url: "https://example.com",
              final_url: "https://example.com/doc",
              title: "Doc",
              text: "# Hello",
              format: "markdown",
            },
          ],
          errors: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new PiWebResearchProvider({
      fetcher,
      env: { TINYFISH_API_KEY: "tf-key" },
    });

    const result = await provider.fetch({ url: "https://example.com" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe("tinyfish");
      expect(result.finalUrl).toBe("https://example.com/doc");
      expect(result.title).toBe("Doc");
      expect(result.contentType).toBe("text/markdown");
      expect(result.text).toBe("# Hello");
      expect(result.truncated).toBe(false);
    }
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({
      "Content-Type": "application/json",
      "X-API-Key": "tf-key",
    });
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        urls: ["https://example.com"],
        format: "markdown",
        links: false,
        image_links: false,
      }),
    );
  });

  it("maps TinyFish per-url fetch errors", async () => {
    const provider = new PiWebResearchProvider({
      fetcher: async () =>
        new Response(
          JSON.stringify({
            results: [],
            errors: [{ url: "https://example.com", error: "bot_blocked", status: 403 }],
          }),
          { status: 200 },
        ),
      env: { TINYFISH_API_KEY: "tf-key" },
    });

    const result = await provider.fetch({ url: "https://example.com" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.provider).toBe("tinyfish");
      expect(result.code).toBe("blocked_fetch");
      expect(result.error).toContain("bot_blocked");
    }
  });
});

describe("SearxngSearchProvider", () => {
  it("uses localhost by default and normalizes SearXNG results", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Vitest",
              url: "https://vitest.dev",
              content: "Fast testing framework",
              engine: "duckduckgo",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new SearxngSearchProvider({ fetcher, env: {} });

    const result = await provider.search({ query: "vitest", maxResults: 1 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.providerUrl).toBe("http://localhost:8888");
      expect(result.results[0]).toEqual({
        title: "Vitest",
        url: "https://vitest.dev",
        snippet: "Fast testing framework",
        source: "duckduckgo",
      });
    }
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("format=json");
  });

  it("rejects public override unless explicitly enabled", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const provider = new SearxngSearchProvider({
      fetcher,
      env: { SEARXNG_URL: "https://search.example.com" },
    });

    const result = await provider.search({ query: "x" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("public_override_not_enabled");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("allows public override when enabled", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ title: "A", url: "https://a.test" }] }), {
        status: 200,
      }),
    );
    const provider = new SearxngSearchProvider({
      fetcher,
      env: {
        SEARXNG_URL: "https://search.example.com",
        SEARXNG_ALLOW_PUBLIC: "true",
      },
    });

    const result = await provider.search({ query: "x" });

    expect(result.ok).toBe(true);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("https://search.example.com/search");
  });

  it("maps SearXNG 403 to json_disabled_or_blocked", async () => {
    const provider = new SearxngSearchProvider({
      fetcher: async () => new Response("forbidden", { status: 403 }),
      env: {},
    });

    const result = await provider.search({ query: "x" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("json_disabled_or_blocked");
    }
  });
});

describe("web research tools", () => {
  it("pi_web_fetch extracts bounded readable text through SearXNG fallback", async () => {
    const tool = makePiWebFetchTool({
      env: { PI_WEB_PROVIDER: "searxng" },
      fetcher: async () =>
        new Response("<html><head><title>Doc</title></head><body><script>x</script><h1>Hello</h1></body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });

    const result = await tool.execute(
      "t1",
      { url: "https://example.com/doc" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(result.details.ok).toBe(true);
    if (result.details.ok) {
      expect(result.details.title).toBe("Doc");
      expect(result.details.text).toContain("Hello");
      expect(result.details.text).not.toContain("script");
    }
  });

  it("pi_web_search returns structured failure details through SearXNG fallback", async () => {
    const tool = makePiWebSearchTool({
      env: { PI_WEB_PROVIDER: "searxng" },
      fetcher: async () => new Response("forbidden", { status: 403 }),
    });

    const result = await tool.execute(
      "t1",
      { query: "x" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(result.details.ok).toBe(false);
    if (!result.details.ok) {
      expect(result.details.code).toBe("json_disabled_or_blocked");
    }
  });

  it("registers generic tool names only", () => {
    expect(makePiWebSearchTool().name).toBe("pi_web_search");
    expect(makePiWebFetchTool().name).toBe("pi_web_fetch");
  });
});

describe("shouldRunWebResearch", () => {
  it("detects external library and latest-info tasks", () => {
    expect(shouldRunWebResearch({ title: "Compare auth libraries" })).toBe(true);
    expect(shouldRunWebResearch({ description: "Use the latest Stripe API" })).toBe(true);
    expect(shouldRunWebResearch({ title: "Tweak button copy" })).toBe(false);
  });
});
