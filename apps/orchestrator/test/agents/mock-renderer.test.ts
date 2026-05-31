import { describe, expect, it, vi, beforeEach } from "vitest";

const { screenshot, setContent, setViewportSize, launch } = vi.hoisted(() => {
  const screenshot = vi.fn(async () => Buffer.from("PNGBYTES"));
  const setContent = vi.fn(async () => undefined);
  const setViewportSize = vi.fn(async () => undefined);
  const route = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  const newPage = vi.fn(async () => ({ setContent, setViewportSize, route, screenshot, close, addStyleTag: vi.fn() }));
  const newContext = vi.fn(async () => ({ newPage, close }));
  const launch = vi.fn(async () => ({ newContext, close }));
  return { screenshot, setContent, setViewportSize, launch };
});

vi.mock("playwright", () => ({ chromium: { launch } }));

import { MockRenderer } from "../../src/agents/mock-renderer.js";

describe("MockRenderer", () => {
  beforeEach(() => {
    screenshot.mockClear();
    setContent.mockClear();
    setViewportSize.mockClear();
  });

  it("renders desktop and mobile PNGs and inlines tokens", async () => {
    const r = new MockRenderer();
    const out = await r.render({ html: "<h1>hi</h1>", tokensCss: ":root{--bg:#fff;}" });
    expect(out.desktopPng).toBeInstanceOf(Buffer);
    expect(out.mobilePng).toBeInstanceOf(Buffer);
    expect(screenshot).toHaveBeenCalledTimes(2);
    // tokens inlined into content
    const contentArg = setContent.mock.calls[0][0] as string;
    expect(contentArg).toContain("--bg:#fff");
    expect(contentArg).toContain("<h1>hi</h1>");
    await r.close();
  });
});
