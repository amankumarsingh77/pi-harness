import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { LiveEventEnvelope } from "@pi-harness/shared";
import type { RunStore } from "../../adapters/run-store.js";
import type { EventStore } from "../../adapters/event-store.js";
import type { ArtifactsStore } from "../../agents/artifacts-store.js";
import type { LiveEventFilter, LiveEventStore } from "../../adapters/live-event-store.js";
import { buildDashboardTaskList } from "./tasks.js";

type LiveQuery = {
  readonly scope?: string;
  readonly taskId?: string;
  readonly runId?: string;
  readonly after?: string;
};

export function registerLiveEventStream(
  app: FastifyInstance,
  deps: {
    readonly liveEvents: LiveEventStore;
    readonly runs: RunStore;
    readonly events: EventStore;
    readonly artifacts: ArtifactsStore;
  },
): void {
  app.get<{ Querystring: LiveQuery }>("/api/live/stream", async (req, reply) => {
    const filter = parseFilter(req.query);
    if (!filter) {
      reply.code(400);
      return {
        error: "invalid_live_stream_filter",
        message: "Pass exactly one of scope=dashboard, taskId, or runId.",
      };
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (event: LiveEventEnvelope): void => {
      reply.raw.write(
        `id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`,
      );
    };

    const afterSequence = Math.max(
      parseCursor(req.headers["last-event-id"]),
      parseCursor(req.query.after),
    );
    const unsub = deps.liveEvents.subscribe(filter, send);
    reply.raw.write(": connected\n\n");

    if ("scope" in filter && filter.scope === "dashboard") {
      send(await dashboardSnapshot(deps));
    } else {
      const existing = await deps.liveEvents.listAfter(filter, afterSequence);
      for (const event of existing) send(event);
    }

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

  app.get("/api/live/cursor", async () => ({
    sequence: await deps.liveEvents.latestSequence(),
  }));
}

function parseFilter(query: LiveQuery): LiveEventFilter | null {
  const provided = [query.scope === "dashboard", Boolean(query.taskId), Boolean(query.runId)]
    .filter(Boolean)
    .length;
  if (provided !== 1) return null;
  if (query.scope === "dashboard") return { scope: "dashboard" };
  if (query.taskId) return { taskId: query.taskId };
  if (query.runId) return { runId: query.runId };
  return null;
}

function parseCursor(value: string | string[] | undefined): number {
  if (typeof value !== "string") return 0;
  const sequence = Number.parseInt(value, 10);
  return Number.isFinite(sequence) && sequence > 0 ? sequence : 0;
}

async function dashboardSnapshot(deps: {
  readonly liveEvents: LiveEventStore;
  readonly runs: RunStore;
  readonly events: EventStore;
  readonly artifacts: ArtifactsStore;
}): Promise<LiveEventEnvelope<"dashboard.snapshot">> {
  const [snapshot, runs, sequence] = await Promise.all([
    buildDashboardTaskList({
      runs: deps.runs,
      eventStore: deps.events,
      artifacts: deps.artifacts,
    }),
    deps.runs.listAllRuns(),
    deps.liveEvents.latestSequence(),
  ]);
  return {
    id: randomUUID(),
    sequence,
    ts: new Date(),
    scope: "dashboard",
    kind: "dashboard.snapshot",
    payload: {
      ...snapshot,
      runs,
    },
  };
}
