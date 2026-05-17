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
        // Tell intermediaries (nginx, Next.js's fetch internals, anything
        // else in the path) not to buffer this stream.
        "X-Accel-Buffering": "no",
      });

      const send = (e: AgentEvent) => {
        reply.raw.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
      };

      const lastEventId = req.headers["last-event-id"];
      const afterId = typeof lastEventId === "string" && lastEventId.length > 0
        ? lastEventId
        : null;

      // Subscribe before replay so an event appended during the initial DB
      // read is still delivered live. Replayed overlap is acceptable because
      // clients dedupe by event id.
      const unsub = deps.events.subscribe(runId, send);

      const existing = await deps.events.listForRunAfter(runId, afterId);
      for (const e of existing) send(e);

      // Heartbeat: an SSE comment line every 25s. Dev proxies (Next.js, nginx
      // with default settings) close idle connections after ~30–60s; without
      // this, a brainstorm tick that takes 40s to emit its next event would
      // surface as a "failed to pipe response" on the dashboard side. The
      // browser's EventSource happily ignores comment lines.
      const heartbeat = setInterval(() => {
        // `write` returns false under backpressure; we don't care here — if
        // the socket is dead the close handler will fire and clear the
        // interval before the next tick.
        reply.raw.write(": ping\n\n");
      }, 25_000);

      req.raw.on("close", () => {
        clearInterval(heartbeat);
        unsub();
        reply.raw.end();
      });

      return new Promise<never>(() => {});
    },
  );
}
