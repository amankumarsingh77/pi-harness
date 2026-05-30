import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { RunStore } from "../adapters/run-store.js";
import type { EventStore } from "../adapters/event-store.js";
import type { LiveEventStore } from "../adapters/live-event-store.js";
import { PreflightStepStore } from "../adapters/preflight-step-store.js";
import type { PreflightStepStore as PreflightStepStoreType } from "../adapters/preflight-step-store.js";
import { ClaimLedgerStore, MissionStore } from "../adapters/mission-store.js";
import type { ClaimLedgerStore as ClaimLedgerStoreType, MissionStore as MissionStoreType } from "../adapters/mission-store.js";
import type { ArtifactsStore } from "../agents/artifacts-store.js";
import { ArtifactsStore as ArtifactsStoreCtor } from "../agents/artifacts-store.js";
import type { TaskScheduler } from "../runner/scheduler.js";
import type { CancellationRegistry } from "../runner/cancellation.js";
import { TaskMutationLock } from "../runner/task-mutation-lock.js";
import { TaskWorkflowService } from "../services/task-workflow-service.js";
import { isHarnessError } from "../domain/errors.js";
import { registerHealth } from "./routes/health.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerArtifactRoutes } from "./routes/artifacts.js";
import { registerScreenshotRoutes } from "./routes/screenshots.js";
import { registerBrainstormRoutes } from "./routes/brainstorm.js";
import { registerPlanRoutes } from "./routes/plan.js";
import { registerLiveEventStream } from "./routes/live.js";
import { registerMissionRoutes } from "./routes/mission.js";
import { registerVerifierRoutes, type VerifierRouteRunners } from "./routes/verifier.js";
import { registerModelOptionRoutes } from "./routes/model-options.js";

export type ServerDeps = {
  runs: RunStore;
  events: EventStore;
  runsDir: string;
  stateDir?: string;
  // Optional override for tests; production builds construct one from runsDir.
  artifacts?: ArtifactsStore;
  // Optional in tests that don't need to drive the agent. Production always
  // provides one — the transitions/answer routes call enqueue after persisting.
  scheduler?: TaskScheduler;
  // Optional in tests. user_cancel uses this to abort an in-flight phase
  // driver before settling its run rows.
  cancellation?: CancellationRegistry;
  mutationLock?: TaskMutationLock;
  // pino instance shared with the rest of the orchestrator. Fastify uses it
  // for HTTP request logging and per-request `req.log` children. When omitted
  // (tests), Fastify falls back to a quiet warn-level logger.
  pinoLogger?: FastifyBaseLogger;
  liveEvents?: LiveEventStore;
  preflightSteps?: PreflightStepStoreType;
  missionStore?: MissionStoreType;
  claimLedger?: ClaimLedgerStoreType;
  verifierRunners?: VerifierRouteRunners;
  workflow?: TaskWorkflowService;
};

export function buildServer(deps: ServerDeps): FastifyInstance {
  // When a pino instance is supplied, hand it to Fastify directly so HTTP
  // request lines and runtime lines share level + transport. The
  // child-on-request feature gives every route a `req.log` with a reqId
  // attached automatically.
  //
  const app: FastifyInstance = Fastify(
    deps.pinoLogger
      ? { loggerInstance: deps.pinoLogger, disableRequestLogging: false }
      : { logger: { level: "warn" }, disableRequestLogging: false },
  );

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

  const stateDir = deps.stateDir ?? ".harness";
  const artifacts = deps.artifacts ?? new ArtifactsStoreCtor({ stateDir });
  const mutationLock = deps.mutationLock ?? new TaskMutationLock();
  const missionStore = deps.missionStore ?? new MissionStore({ stateDir });
  const claimLedger = deps.claimLedger ?? new ClaimLedgerStore({ stateDir });
  const preflightSteps = deps.preflightSteps ?? new PreflightStepStore({ stateDir });
  const workflow = deps.workflow ?? new TaskWorkflowService({
    runs: deps.runs,
    events: deps.events,
    artifacts,
    missionStore,
    mutationLock,
    ...(deps.scheduler ? { scheduler: deps.scheduler } : {}),
    ...(deps.cancellation ? { cancellation: deps.cancellation } : {}),
  });
  registerHealth(app);
  registerModelOptionRoutes(app);
  registerTaskRoutes(app, {
    runs: deps.runs,
    events: deps.events,
    artifacts,
    missionStore,
    workflow,
    mutationLock,
    ...(deps.scheduler ? { scheduler: deps.scheduler } : {}),
    ...(deps.cancellation ? { cancellation: deps.cancellation } : {}),
  });
  registerRunRoutes(app, { runs: deps.runs, events: deps.events });
  registerMissionRoutes(app, {
    runs: deps.runs,
    missionStore,
    claimLedger,
    ...(deps.liveEvents ? { liveEvents: deps.liveEvents } : {}),
  });
  registerVerifierRoutes(app, {
    runs: deps.runs,
    artifacts,
    claimLedger,
    ...(deps.liveEvents ? { liveEvents: deps.liveEvents } : {}),
    ...(deps.verifierRunners ? { runners: deps.verifierRunners } : {}),
  });
  if (deps.liveEvents) {
    registerLiveEventStream(app, {
      liveEvents: deps.liveEvents,
      runs: deps.runs,
      events: deps.events,
      artifacts,
    });
  }
  registerArtifactRoutes(app, { runsDir: deps.runsDir });
  registerScreenshotRoutes(app, { runsDir: deps.runsDir });
  registerBrainstormRoutes(app, {
    runs: deps.runs,
    artifacts,
    events: deps.events,
    workflow,
    mutationLock,
    ...(deps.scheduler ? { scheduler: deps.scheduler } : {}),
    ...(deps.cancellation ? { cancellation: deps.cancellation } : {}),
  });
  registerPlanRoutes(app, {
    runs: deps.runs,
    artifacts,
    events: deps.events,
    workflow,
    mutationLock,
    preflightSteps,
    ...(deps.scheduler ? { scheduler: deps.scheduler } : {}),
    ...(deps.cancellation ? { cancellation: deps.cancellation } : {}),
  });
  return app;
}
