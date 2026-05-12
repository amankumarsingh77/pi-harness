import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DashboardEvent } from "@pi-harness/shared";
import type { RunStore } from "../../adapters/run-store.js";
import type { DashboardEventBus } from "../../adapters/dashboard-event-bus.js";

export function registerDashboardEventStream(
  app: FastifyInstance,
  deps: { runs: RunStore; dashboardEvents: DashboardEventBus },
): void {
  app.get("/api/dashboard/events/stream", async (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (e: DashboardEvent) => {
      reply.raw.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
    };

    const unsub = deps.dashboardEvents.subscribe(send);

    const [tasks, counts, runs] = await Promise.all([
      deps.runs.listTasks(),
      deps.runs.countByStatus(),
      deps.runs.listAllRuns(),
    ]);
    send({
      id: randomUUID(),
      ts: new Date(),
      kind: "tasks_snapshot",
      tasks,
      counts,
      runs,
    });

    const heartbeat = setInterval(() => {
      reply.raw.write(": ping\n\n");
    }, 25_000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsub();
      reply.raw.end();
    });

    return new Promise<never>(() => {});
  });
}
