import type { FastifyInstance } from "fastify";
import type { RunStore } from "../../adapters/run-store.js";
import type { EventStore } from "../../adapters/event-store.js";

export function registerRunRoutes(
  app: FastifyInstance,
  deps: { runs: RunStore; events: EventStore },
): void {
  const { events } = deps;

  app.get<{ Params: { id: string } }>("/api/runs/:id/events", async (req) => {
    return { events: await events.listForRun(req.params.id) };
  });
}
