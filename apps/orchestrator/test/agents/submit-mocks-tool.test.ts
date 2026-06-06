import { describe, expect, it, vi } from "vitest";
import { makeSubmitMocksTool } from "../../src/agents/brainstorm-tools.js";

function deps() {
  return {
    store: {
      writeBrainstormMock: vi.fn(async () => undefined),
      writeBrainstormMockRender: vi.fn(async () => undefined),
    },
    designSystem: {
      read: vi.fn(async () => ({ tokensCss: ":root{--fg:#000;}", exists: true })),
      readDraftTokens: vi.fn(async () => ""),
    },
    renderer: { render: vi.fn(async () => ({ desktopPng: Buffer.from("D"), mobilePng: Buffer.from("M") })) },
    bus: { publish: vi.fn(async () => undefined) },
    cwd: "/cwd",
    taskId: "t_1",
  };
}

describe("submit_mocks tool", () => {
  it("rejects a mock that hard-codes a core token", async () => {
    const d = deps();
    const tool = makeSubmitMocksTool(d as never);
    const res = await tool.execute("id", {
      mocks: [{ mockId: "m_1", title: "T", summary: "S", recommended: true,
        evidence: ["apps/dashboard/app/globals.css:3"],
        pages: [{ pageId: "home", title: "Home", html: "<style>.a{color:#f00;}</style>" }] }],
    } as never, undefined, undefined, undefined as never);
    expect(res.details).toMatchObject({ ok: false });
    expect(d.renderer.render).not.toHaveBeenCalled();
    expect(d.bus.publish).not.toHaveBeenCalled();
  });

  it("rejects a mock that does not cite current UI design evidence", async () => {
    const d = deps();
    const tool = makeSubmitMocksTool(d as never);
    const res = await tool.execute("id", {
      mocks: [{ mockId: "m_1", title: "T", summary: "S", recommended: true,
        pages: [{ pageId: "home", title: "Home", html: "<style>.a{color:var(--fg);}</style>" }] }],
    } as never, undefined, undefined, undefined as never);
    expect(res.details).toMatchObject({ ok: false });
    expect(d.renderer.render).not.toHaveBeenCalled();
    expect(d.store.writeBrainstormMock).not.toHaveBeenCalled();
    expect(d.bus.publish).not.toHaveBeenCalled();
  });

  it("renders, persists, and publishes a conformant mock", async () => {
    const d = deps();
    const tool = makeSubmitMocksTool(d as never);
    const res = await tool.execute("id", {
      mocks: [{ mockId: "m_1", title: "T", summary: "S", recommended: true,
        evidence: ["apps/dashboard/app/globals.css:3"],
        pages: [{ pageId: "home", title: "Home", html: "<style>.a{color:var(--fg);}</style>" }] }],
    } as never, undefined, undefined, undefined as never);
    expect(d.renderer.render).toHaveBeenCalledTimes(1);
    expect(d.store.writeBrainstormMockRender).toHaveBeenCalledTimes(1);
    expect(d.bus.publish).toHaveBeenCalledWith(expect.objectContaining({
      kind: "brainstorm_mock_proposed",
      mock: expect.objectContaining({ evidence: ["apps/dashboard/app/globals.css:3"] }),
    }));
    expect(res.terminate).toBe(true);
  });
});
