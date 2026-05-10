import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { RunStore } from "../../adapters/run-store.js";
import type { EventStore } from "../../adapters/event-store.js";

export type FileTouched = {
  path: string;
  added: number;
  removed: number;
  state: "live" | "settled";
};

export function registerRunRoutes(
  app: FastifyInstance,
  deps: { runs: RunStore; events: EventStore },
): void {
  const { runs, events } = deps;

  app.get<{ Params: { id: string } }>("/api/runs/:id/events", async (req) => {
    return { events: await events.listForRun(req.params.id) };
  });

  // Files touched on the run's worktree branch, computed from `git diff
  // --numstat` against the merge-base with `main`. Returns an empty list
  // when the worktree path is missing or git isn't a repo there — never
  // 500s, since this surface is informational on the task detail page.
  app.get<{ Params: { id: string } }>("/api/runs/:id/files", async (req) => {
    const run = await runs.getRun(req.params.id);
    const task = await runs.getTask(run.taskId);
    const worktree = task.worktreePath;
    if (!worktree || !existsSync(worktree)) {
      return { files: [] as FileTouched[] };
    }
    const isLive = run.status === "running" || run.status === "pending";
    const state: FileTouched["state"] = isLive ? "live" : "settled";
    try {
      const numstat = await runGit(worktree, ["diff", "--numstat", "main..."]);
      const files = parseNumstat(numstat).map((f) => ({ ...f, state }));
      return { files };
    } catch {
      return { files: [] as FileTouched[] };
    }
  });
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git ${args.join(" ")} exited ${code}: ${stderr}`));
    });
  });
}

function parseNumstat(out: string): { path: string; added: number; removed: number }[] {
  const lines = out.split("\n").filter((l) => l.trim().length > 0);
  const result: { path: string; added: number; removed: number }[] = [];
  for (const line of lines) {
    // Format: <added>\t<removed>\t<path>. Binary files report "-\t-".
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const added = parts[0] === "-" ? 0 : Number.parseInt(parts[0]!, 10);
    const removed = parts[1] === "-" ? 0 : Number.parseInt(parts[1]!, 10);
    if (Number.isNaN(added) || Number.isNaN(removed)) continue;
    result.push({ path: parts.slice(2).join("\t"), added, removed });
  }
  return result;
}
