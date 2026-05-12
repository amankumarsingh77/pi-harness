import { describe, it, expect, vi } from "vitest";
import { api, ApiError } from "@/lib/api";
import type { Phase, PhaseModelConfig } from "@pi-harness/shared";

describe("api", () => {
  it("listTasks returns parsed shape", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({ tasks: [], counts: { backlog: 0 } }),
    );
    const a = api({ baseUrl: "http://x", fetch: fetchSpy });

    const r = await a.listTasks();
    expect(r.tasks).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledWith("http://x/api/tasks", expect.any(Object));
  });

  it("throws ApiError on non-2xx", async () => {
    const a = api({
      baseUrl: "http://x",
      fetch: async () => Response.json({ error: "not_found", message: "x" }, { status: 404 }),
    });
    await expect(a.getTask("nope")).rejects.toBeInstanceOf(ApiError);
  });

  it("createTask POSTs body", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({ id: "1", status: "backlog", title: "t", description: "" }, { status: 201 }),
    );
    const a = api({ baseUrl: "http://x", fetch: fetchSpy });

    await a.createTask({ title: "t" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://x/api/tasks",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "t" }) }),
    );
  });

  it("createTask POSTs phaseModels when provided", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({ id: "1", status: "backlog", title: "t", description: "" }, { status: 201 }),
    );
    const a = api({ baseUrl: "http://x", fetch: fetchSpy });
    const phaseModels = {
      brainstorm: { provider: "crofai", model: "kimi-k2.6", thinkingLevel: "medium" },
    } satisfies Partial<Record<Phase, Partial<PhaseModelConfig>>>;

    await a.createTask({ title: "t", phaseModels });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://x/api/tasks",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "t", phaseModels }) }),
    );
  });

  it("getModelCatalog fetches catalog endpoint", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ providers: [], defaults: {} }));
    const a = api({ baseUrl: "http://x", fetch: fetchSpy });

    await a.getModelCatalog();
    expect(fetchSpy).toHaveBeenCalledWith("http://x/api/model-catalog", expect.any(Object));
  });
});
