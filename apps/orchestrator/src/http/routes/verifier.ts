import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { VerifierRunRequestSchema, VerifierSidecarResultSchema, runVerifierSidecar } from "../../agents/verifier-sidecar.js";
import { runApiScenario, runUiScenario, runUiVisualScenario } from "../../agents/verify-runner.js";
import type { ArtifactsStore } from "../../agents/artifacts-store.js";
import type { ClaimLedgerStore } from "../../adapters/mission-store.js";
import type { RunStore } from "../../adapters/run-store.js";
import type { LiveEventStore } from "../../adapters/live-event-store.js";
import { ValidationError } from "../../domain/errors.js";

export function registerVerifierRoutes(
  app: FastifyInstance,
  deps: {
    readonly runs: RunStore;
    readonly artifacts: ArtifactsStore;
    readonly claimLedger: ClaimLedgerStore;
    readonly liveEvents?: LiveEventStore;
    readonly runners?: VerifierRouteRunners;
  },
): void {
  app.post<{ Params: { id: string } }>("/api/tasks/:id/verifier/run", async (req, reply) => {
    let body;
    try {
      body = VerifierRunRequestSchema.parse(req.body ?? {});
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ValidationError("invalid verifier run body", { issues: err.issues });
      }
      throw err;
    }

    const task = await deps.runs.getTask(req.params.id);
    if (!task.worktreePath) {
      reply.code(409);
      return {
        error: "no_worktree",
        message: "task has no worktree yet",
      };
    }

    const baseUrl = requestBaseUrl(req.protocol, req.socket.localPort, req.headers.host);
    const result = await runVerifierSidecar({
      taskId: task.id,
      runId: `manual-verifier-${Date.now()}`,
      cwd: task.worktreePath,
      store: deps.artifacts,
      claimLedger: deps.claimLedger,
      ...(deps.liveEvents ? { publishClaimsUpdated: deps.liveEvents.publishClaimsUpdated.bind(deps.liveEvents) } : {}),
      mode: body.mode,
      ...(body.claimIds !== undefined ? { claimIds: body.claimIds } : {}),
      runApiScenario: (opts) =>
        (deps.runners?.runApiScenario ?? runApiScenario)({
          ...opts,
          ...(baseUrl ? { baseUrl } : {}),
        }),
      runUiScenario: (opts) =>
        (deps.runners?.runUiScenario ?? runUiScenario)({
          ...opts,
          ...(baseUrl ? { baseUrl } : {}),
        }),
      runUiVisualScenario: (opts) =>
        (deps.runners?.runUiVisualScenario ?? runUiVisualScenario)({
          ...opts,
          ...(baseUrl ? { baseUrl } : {}),
        }),
    });
    return VerifierSidecarResultSchema.parse(result);
  });
}

export type VerifierRouteRunners = {
  readonly runApiScenario: typeof runApiScenario;
  readonly runUiScenario: typeof runUiScenario;
  readonly runUiVisualScenario: typeof runUiVisualScenario;
};

function requestBaseUrl(
  protocol: string,
  localPort: number | undefined,
  host: string | undefined,
): string | undefined {
  if (localPort !== undefined) return `${protocol}://127.0.0.1:${localPort}`;
  return host ? `${protocol}://${host}` : undefined;
}
