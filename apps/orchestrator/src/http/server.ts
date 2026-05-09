import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { RunStore } from "../adapters/run-store.js";
import type { EventStore } from "../adapters/event-store.js";
import type { ArtifactsStore } from "../agents/artifacts-store.js";
import { ArtifactsStore as ArtifactsStoreCtor } from "../agents/artifacts-store.js";
import type { TaskScheduler } from "../runner/scheduler.js";
import { isHarnessError } from "../domain/errors.js";
import { registerHealth } from "./routes/health.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerEventStream } from "./routes/events.js";
import { registerArtifactRoutes } from "./routes/artifacts.js";
import { registerScreenshotRoutes } from "./routes/screenshots.js";
import { registerBrainstormRoutes } from "./routes/brainstorm.js";

export type ServerDeps = {
  runs: RunStore;
  events: EventStore;
  runsDir: string;
  // Optional override for tests; production builds construct one from runsDir.
  artifacts?: ArtifactsStore;
  // Optional in tests that don't need to drive the agent. Production always
  // provides one — the transitions/answer routes call enqueue after persisting.
  scheduler?: TaskScheduler;
};

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: { level: "warn" } });
  // CORS so the Next.js dashboard (Plan 4) can call us in dev.
  void app.register(cors, { origin: true });

  // Centralized error handling — every route's HarnessError throws map to
  // the right status code + structured body. Default 500 for everything else.
  app.setErrorHandler((err, _req, reply) => {
    if (isHarnessError(err)) {
      reply.code(err.status);
      return reply.send({ error: err.code, message: err.message, details: err.details });
    }
    reply.code(500);
    const message = err instanceof Error ? err.message : String(err);
    return reply.send({ error: "internal", message });
  });

  const artifacts = deps.artifacts ?? new ArtifactsStoreCtor();
  registerHealth(app);
  registerTaskRoutes(app, { runs: deps.runs, ...(deps.scheduler ? { scheduler: deps.scheduler } : {}) });
  registerRunRoutes(app, { runs: deps.runs, events: deps.events });
  registerEventStream(app, { events: deps.events });
  registerArtifactRoutes(app, { runsDir: deps.runsDir });
  registerScreenshotRoutes(app, { runsDir: deps.runsDir });
  registerBrainstormRoutes(app, {
    runs: deps.runs,
    artifacts,
    ...(deps.scheduler ? { scheduler: deps.scheduler } : {}),
  });
  return app;
}
