import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { Logger as PinoLogger } from "pino";
import type { RunStore } from "../adapters/run-store.js";
import type { EventStore } from "../adapters/event-store.js";
import type { ArtifactsStore } from "../agents/artifacts-store.js";
import { ArtifactsStore as ArtifactsStoreCtor } from "../agents/artifacts-store.js";
import type { TaskScheduler } from "../runner/scheduler.js";
import type { CancellationRegistry } from "../runner/cancellation.js";
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
  // Optional in tests. user_cancel uses this to abort an in-flight phase
  // driver before settling its run rows.
  cancellation?: CancellationRegistry;
  // pino instance shared with the rest of the orchestrator. Fastify uses it
  // for HTTP request logging and per-request `req.log` children. When omitted
  // (tests), Fastify falls back to a quiet warn-level logger.
  pinoLogger?: PinoLogger;
};

export function buildServer(deps: ServerDeps): FastifyInstance {
  // When a pino instance is supplied, hand it to Fastify directly so HTTP
  // request lines and runtime lines share level + transport. The
  // child-on-request feature gives every route a `req.log` with a reqId
  // attached automatically.
  //
  // The `as FastifyInstance` widens away the logger generic Fastify infers
  // from `loggerInstance`. Without it the route-register helpers refuse the
  // narrower type under `exactOptionalPropertyTypes`. We don't use that
  // narrower view anywhere, so the cast is purely cosmetic.
  const app = Fastify(
    deps.pinoLogger
      ? { loggerInstance: deps.pinoLogger, disableRequestLogging: false }
      : { logger: { level: "warn" }, disableRequestLogging: false },
  ) as unknown as FastifyInstance;

  // CORS so the Next.js dashboard (Plan 4) can call us in dev.
  void app.register(cors, { origin: true });

  // Centralized error handling — every route's HarnessError throws map to
  // the right status code + structured body. Default 500 for everything else.
  app.setErrorHandler((err, req, reply) => {
    if (isHarnessError(err)) {
      req.log.warn({ err, code: err.code, status: err.status }, "request rejected");
      reply.code(err.status);
      return reply.send({ error: err.code, message: err.message, details: err.details });
    }
    req.log.error({ err }, "unhandled request error");
    reply.code(500);
    const message = err instanceof Error ? err.message : String(err);
    return reply.send({ error: "internal", message });
  });

  const artifacts = deps.artifacts ?? new ArtifactsStoreCtor();
  registerHealth(app);
  registerTaskRoutes(app, {
    runs: deps.runs,
    events: deps.events,
    artifacts,
    ...(deps.scheduler ? { scheduler: deps.scheduler } : {}),
    ...(deps.cancellation ? { cancellation: deps.cancellation } : {}),
  });
  registerRunRoutes(app, { runs: deps.runs, events: deps.events });
  registerEventStream(app, { events: deps.events });
  registerArtifactRoutes(app, { runsDir: deps.runsDir });
  registerScreenshotRoutes(app, { runsDir: deps.runsDir });
  registerBrainstormRoutes(app, {
    runs: deps.runs,
    artifacts,
    events: deps.events,
    ...(deps.scheduler ? { scheduler: deps.scheduler } : {}),
    ...(deps.cancellation ? { cancellation: deps.cancellation } : {}),
  });
  return app;
}
