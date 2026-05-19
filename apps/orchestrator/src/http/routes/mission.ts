import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import {
  ClaimEvidenceSchema,
  ClaimStatusSchema,
  MissionPatchSchema,
} from "@pi-harness/shared";
import type { ClaimLedgerStore, MissionStore } from "../../adapters/mission-store.js";
import type { RunStore } from "../../adapters/run-store.js";
import type { LiveEventStore } from "../../adapters/live-event-store.js";
import { ValidationError } from "../../domain/errors.js";

const ClaimStatusPatchSchema = z
  .object({
    status: ClaimStatusSchema,
    verifierNote: z.string().min(1).max(4000).optional(),
    evidence: z.array(ClaimEvidenceSchema).optional(),
  })
  .strict();

export function registerMissionRoutes(
  app: FastifyInstance,
  deps: {
    runs: RunStore;
    missionStore: MissionStore;
    claimLedger: ClaimLedgerStore;
    liveEvents?: LiveEventStore;
  },
): void {
  app.get<{ Params: { id: string } }>("/api/tasks/:id/mission", async (req) => {
    const task = await deps.runs.getTask(req.params.id);
    const mission = await deps.missionStore.ensureMission(task);
    const [claims, events, claimEvents] = await Promise.all([
      deps.claimLedger.listClaims(task.id),
      deps.missionStore.listEvents(task.id),
      deps.claimLedger.listEvents(task.id),
    ]);
    return { mission, claims, events, claimEvents };
  });

  app.patch<{ Params: { id: string } }>("/api/tasks/:id/mission", async (req) => {
    const task = await deps.runs.getTask(req.params.id);
    let patch;
    try {
      patch = MissionPatchSchema.parse(req.body);
    } catch (e) {
      if (e instanceof ZodError) throw new ValidationError("invalid mission patch", { issues: e.issues });
      throw e;
    }

    const mission = await deps.missionStore.updateMission(task, patch);
    const [claims, events, claimEvents] = await Promise.all([
      deps.claimLedger.listClaims(task.id),
      deps.missionStore.listEvents(task.id),
      deps.claimLedger.listEvents(task.id),
    ]);
    await deps.liveEvents?.publishMissionUpdated(task.id, {
      mission,
      event: events.at(-1) ?? null,
    });
    return { mission, claims, events, claimEvents };
  });

  app.post<{ Params: { id: string; claimId: string } }>(
    "/api/tasks/:id/claims/:claimId/status",
    async (req) => {
      const task = await deps.runs.getTask(req.params.id);
      let patch;
      try {
        patch = ClaimStatusPatchSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) throw new ValidationError("invalid claim status patch", { issues: e.issues });
        throw e;
      }

      const result = await deps.claimLedger.updateClaimStatus(task.id, req.params.claimId, patch);
      const [mission, events, claimEvents] = await Promise.all([
        deps.missionStore.ensureMission(task),
        deps.missionStore.listEvents(task.id),
        deps.claimLedger.listEvents(task.id),
      ]);
      await deps.liveEvents?.publishClaimsUpdated(task.id, {
        taskId: task.id,
        claims: result.claims,
        claimEvents: result.events,
      });
      return { mission, claims: result.claims, events, claimEvents };
    },
  );
}
