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
import type { DesignSystemStore } from "../agents/design-system-store.js";
import { DesignSystemStore as DesignSystemStoreCtor } from "../agents/design-system-store.js";
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
import { registerChatRoutes } from "./routes/chat.js";
import { ChatSessionStore } from "../adapters/chat-store.js";
import type { ChatSessionStore as ChatSessionStoreType } from "../adapters/chat-store.js";
import { registerProviderRoutes } from "./routes/providers.js";

export type ServerDeps = {
  runs: RunStore;
  events: EventStore;
  runsDir: string;
  stateDir?: string;
  // Optional override for tests; production builds construct one from runsDir.
  artifacts?: ArtifactsStore;
  // Optional in tests; production wires the project-level design system store.
  designSystem?: DesignSystemStore;
  // Repo root where the project-level design system lives. Defaults to cwd.
  designRootCwd?: string;
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
  // Optional in tests that don't exercise chat routes. Production constructs one from stateDir.
  chatStore?: ChatSessionStoreType;
  // Injectable createAgentSession for chat routes. Tests provide a scripted mock; production uses the live SDK.
  chatCreateAgentSession?: import("../agents/chat-session.js").CreateAgentSessionFn;
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
  const designSystem = deps.designSystem ?? new DesignSystemStoreCtor({ stateDir });
  const designRootCwd = deps.designRootCwd ?? process.cwd();
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
  registerProviderRoutes(app);
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
    designSystem,
    designRootCwd,
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
  // Chat routes — always registered; chatStore defaults to a new instance when not injected.
  const chatStore = deps.chatStore ?? new ChatSessionStore({ stateDir });
  registerChatRoutes(app, {
    chatStore,
    ...(deps.chatCreateAgentSession ? { createAgentSession: deps.chatCreateAgentSession } : {}),
  });
  return app;
}
