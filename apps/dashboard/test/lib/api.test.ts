import { describe, it, expect, vi } from "vitest";
import { api, ApiError } from "@/lib/api";

describe("api", () => {
  it("listTasks returns parsed shape", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({
        tasks: [],
        counts: { backlog: 0 },
        summary: {
          runningCount: 0,
          reviewCount: 0,
          blockedCount: 0,
          costUsd: 0,
          costCapUsd: 10,
          lastEventAt: "2026-05-15T10:00:00.000Z",
          activeRunIds: [],
        },
      }),
    );
    const a = api({ baseUrl: "http://x", fetch: fetchSpy });

    const r = await a.listTasks();
    expect(r.tasks).toEqual([]);
    expect(r.summary.lastEventAt?.toISOString()).toBe("2026-05-15T10:00:00.000Z");
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
      Response.json({
        id: "1",
        status: "backlog",
        title: "t",
        description: "",
        priority: "urgent",
        tags: ["bugfix"],
      }, { status: 201 }),
    );
    const a = api({ baseUrl: "http://x", fetch: fetchSpy });

    await a.createTask({ title: "t", priority: "urgent", tags: ["bugfix"] });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://x/api/tasks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "t", priority: "urgent", tags: ["bugfix"] }),
      }),
    );
  });
});
