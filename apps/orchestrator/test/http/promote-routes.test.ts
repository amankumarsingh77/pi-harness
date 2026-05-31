import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerBrainstormRoutes } from "../../src/http/routes/brainstorm.js";

function buildApp(overrides: Record<string, unknown> = {}) {
  const app = Fastify();
  const deps = {
    runs: { getTask: async () => ({ id: "t_1", worktreePath: "/wt" }) },
    artifacts: {
      readBrainstormMockManifest: async () => ({ mocks: [{ mockId: "m_1", title: "T", pages: [{ pageId: "home" }] }], selectedMockId: null }),
      readBrainstormMockHtml: async () => "<style>.a{color:#2563eb;}</style>",
    },
    designSystem: {
      read: async () => ({ exists: true, tokensCss: ":root{--fg:#000;}", designMd: "# D", manifest: { tokenVersion: 2, updatedAt: "x", exemplars: [], history: [] } }),
    },
    designRootCwd: "/repo",
    workflow: {},
    ...overrides,
  };
  registerBrainstormRoutes(app as never, deps as never);
  return app;
}

describe("promote routes", () => {
  it("promote returns a distilled token diff without writing", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/api/tasks/t_1/brainstorm/mocks/m_1/promote", payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fromVersion).toBe(2);
    expect(body.toVersion).toBe(3);
    expect(Array.isArray(body.changes)).toBe(true);
  });

  it("GET /api/design returns the snapshot", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/design" });
    expect(res.statusCode).toBe(200);
    expect(res.json().manifest.tokenVersion).toBe(2);
  });
});
