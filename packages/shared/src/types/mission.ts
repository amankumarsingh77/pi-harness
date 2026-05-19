import { z } from "zod";

export const MissionRiskLevelSchema = z.enum(["low", "medium", "high"]);
export type MissionRiskLevel = z.infer<typeof MissionRiskLevelSchema>;

export const ClaimStatusSchema = z.enum([
  "pending",
  "challenged",
  "proven",
  "failed",
  "accepted_risk",
]);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

export const ClaimSourceSchema = z.enum(["plan", "code", "verify", "human"]);
export type ClaimSource = z.infer<typeof ClaimSourceSchema>;

export const ClaimEvidenceSchema = z.object({
  kind: z.enum(["test", "scenario", "artifact", "diff", "screenshot", "log", "manual"]),
  ref: z.string().min(1),
  note: z.string().min(1).optional(),
});
export type ClaimEvidence = z.infer<typeof ClaimEvidenceSchema>;

export const MissionPacketSchema = z.object({
  taskId: z.string().min(1),
  goal: z.string().min(1),
  successCriteria: z.array(z.string().min(1)).min(1),
  constraints: z.array(z.string().min(1)),
  riskLevel: MissionRiskLevelSchema,
  workflowIntent: z.string().min(1),
  affectedAreas: z.array(z.string().min(1)),
  policyProfile: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MissionPacket = z.infer<typeof MissionPacketSchema>;

export const MissionPatchSchema = MissionPacketSchema.pick({
  goal: true,
  successCriteria: true,
  constraints: true,
  riskLevel: true,
  workflowIntent: true,
  affectedAreas: true,
  policyProfile: true,
}).partial();
export type MissionPatch = z.infer<typeof MissionPatchSchema>;

export const MissionEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("mission.initialized"),
    taskId: z.string().min(1),
    mission: MissionPacketSchema,
    ts: z.string().datetime(),
  }),
  z.object({
    type: z.literal("mission.updated"),
    taskId: z.string().min(1),
    patch: MissionPatchSchema,
    ts: z.string().datetime(),
  }),
]);
export type MissionEvent = z.infer<typeof MissionEventSchema>;

const ClaimCreatedEventSchema = z.object({
  type: z.literal("claim.created"),
  claimId: z.string().min(1),
  taskId: z.string().min(1),
  sourceKey: z.string().min(1),
  text: z.string().min(1),
  owner: z.string().min(1),
  source: ClaimSourceSchema,
  createdAt: z.string().datetime(),
});

const ClaimStatusChangedEventSchema = z.object({
  type: z.literal("claim.status_changed"),
  claimId: z.string().min(1),
  taskId: z.string().min(1),
  status: ClaimStatusSchema,
  verifierNote: z.string().min(1).optional(),
  evidence: z.array(ClaimEvidenceSchema).optional(),
  updatedAt: z.string().datetime(),
});

const ClaimEvidenceAddedEventSchema = z.object({
  type: z.literal("claim.evidence_added"),
  claimId: z.string().min(1),
  taskId: z.string().min(1),
  evidence: z.array(ClaimEvidenceSchema).min(1),
  updatedAt: z.string().datetime(),
});

const ClaimNoteAddedEventSchema = z.object({
  type: z.literal("claim.note_added"),
  claimId: z.string().min(1),
  taskId: z.string().min(1),
  verifierNote: z.string().min(1),
  updatedAt: z.string().datetime(),
});

export const ClaimEventSchema = z.discriminatedUnion("type", [
  ClaimCreatedEventSchema,
  ClaimStatusChangedEventSchema,
  ClaimEvidenceAddedEventSchema,
  ClaimNoteAddedEventSchema,
]);
export type ClaimEvent = z.infer<typeof ClaimEventSchema>;

export const ClaimSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  sourceKey: z.string().min(1),
  text: z.string().min(1),
  owner: z.string().min(1),
  status: ClaimStatusSchema,
  evidence: z.array(ClaimEvidenceSchema),
  source: ClaimSourceSchema,
  verifierNote: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Claim = z.infer<typeof ClaimSchema>;

export function foldClaimEvents(events: ReadonlyArray<ClaimEvent>): Claim[] {
  const claimsById = new Map<string, Claim>();
  const idBySourceKey = new Map<string, string>();

  for (const event of events) {
    if (event.type === "claim.created") {
      const existingId = idBySourceKey.get(event.sourceKey);
      const claimId = existingId ?? event.claimId;
      const existing = claimsById.get(claimId);
      const next: Claim = {
        id: claimId,
        taskId: event.taskId,
        sourceKey: event.sourceKey,
        text: event.text,
        owner: event.owner,
        status: existing?.status ?? "pending",
        evidence: existing?.evidence ?? [],
        source: event.source,
        ...(existing?.verifierNote !== undefined
          ? { verifierNote: existing.verifierNote }
          : {}),
        createdAt: existing?.createdAt ?? event.createdAt,
        updatedAt: event.createdAt,
      };
      claimsById.set(claimId, next);
      idBySourceKey.set(event.sourceKey, claimId);
      continue;
    }

    const existing = claimsById.get(event.claimId);
    if (!existing) continue;

    if (event.type === "claim.status_changed") {
      claimsById.set(event.claimId, {
        ...existing,
        status: event.status,
        evidence: mergeEvidence(existing.evidence, event.evidence ?? []),
        ...(event.verifierNote !== undefined ? { verifierNote: event.verifierNote } : {}),
        updatedAt: event.updatedAt,
      });
      continue;
    }

    if (event.type === "claim.evidence_added") {
      claimsById.set(event.claimId, {
        ...existing,
        evidence: mergeEvidence(existing.evidence, event.evidence),
        updatedAt: event.updatedAt,
      });
      continue;
    }

    claimsById.set(event.claimId, {
      ...existing,
      verifierNote: event.verifierNote,
      updatedAt: event.updatedAt,
    });
  }

  return [...claimsById.values()];
}

function mergeEvidence(
  current: ReadonlyArray<ClaimEvidence>,
  incoming: ReadonlyArray<ClaimEvidence>,
): ClaimEvidence[] {
  const seen = new Set(current.map(evidenceKey));
  const added = incoming.filter((item) => {
    const key = evidenceKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...current, ...added];
}

function evidenceKey(item: ClaimEvidence): string {
  return `${item.kind}\u0000${item.ref}\u0000${item.note ?? ""}`;
}
