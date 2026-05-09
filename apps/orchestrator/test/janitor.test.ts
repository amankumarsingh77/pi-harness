import { describe, it, expect, vi } from "vitest";
import { reconcileWorktrees } from "../src/runner/janitor.js";

describe("reconcileWorktrees", () => {
  it("removes worktrees whose taskId is not in the active set", async () => {
    const removed: string[] = [];
    const wm = {
      list: vi.fn(async () => [
        { taskId: "active-1", path: "/x/a1", branch: "feat/a1" },
        { taskId: "orphan-9", path: "/x/o9", branch: "feat/o9" },
      ]),
      remove: vi.fn(async (id: string) => {
        removed.push(id);
      }),
    };

    const report = await reconcileWorktrees({
      worktreeManager: wm,
      activeTaskIds: new Set(["active-1"]),
    });

    expect(removed).toEqual(["orphan-9"]);
    expect(report.removed).toEqual(["orphan-9"]);
    expect(report.kept).toEqual(["active-1"]);
  });
});
