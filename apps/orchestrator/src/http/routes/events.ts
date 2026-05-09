import type { FastifyInstance } from "fastify";
import type { AgentEvent } from "@pi-harness/shared";
import type { EventStore } from "../../adapters/event-store.js";

export function registerEventStream(
  app: FastifyInstance,
  deps: { events: EventStore },
): void {
  app.get<{ Params: { id: string } }>(
    "/api/runs/:id/events/stream",
    async (req, reply) => {
      const runId = req.params.id;

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const send = (e: AgentEvent) => {
        reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
      };

      // Replay everything we have, then subscribe.
      // (Race: events appended between listForRun and subscribe could be missed.
      // For v1 this is acceptable; v2 can switch to a SQL cursor for ordering.)
      const existing = await deps.events.listForRun(runId);
      for (const e of existing) send(e);

      const unsub = deps.events.subscribe(runId, send);

      req.raw.on("close", () => {
        unsub();
        reply.raw.end();
      });

      // Keep the response open.
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return new Promise<never>(() => {});
    },
  );
}
