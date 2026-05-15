import { describe, expect, it, vi } from "vitest";
import {
  makeSearXNGFetchTool,
  makeSearXNGSearchTool,
  SearxngSearchProvider,
  shouldRunWebResearch,
} from "../../src/agents/web-research-tools.js";

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
  it("searxng_fetch extracts bounded readable text", async () => {
    const tool = makeSearXNGFetchTool({
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

  it("searxng_search returns structured failure details", async () => {
    const tool = makeSearXNGSearchTool({
      fetcher: async () => new Response("forbidden", { status: 403 }),
      env: {},
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
});

describe("shouldRunWebResearch", () => {
  it("detects external library and latest-info tasks", () => {
    expect(shouldRunWebResearch({ title: "Compare auth libraries" })).toBe(true);
    expect(shouldRunWebResearch({ description: "Use the latest Stripe API" })).toBe(true);
    expect(shouldRunWebResearch({ title: "Tweak button copy" })).toBe(false);
  });
});
