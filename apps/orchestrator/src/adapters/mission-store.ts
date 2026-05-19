import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ClaimEventSchema,
  MissionEventSchema,
  MissionPacketSchema,
  MissionPatchSchema,
  foldClaimEvents,
  type Claim,
  type ClaimEvent,
  type ClaimEvidence,
  type ClaimStatus,
  type MissionEvent,
  type MissionPacket,
  type MissionPatch,
  type Task,
} from "@pi-harness/shared";

type Clock = () => string;

export type MissionStoreOpts = {
  readonly stateDir: string;
  readonly now?: Clock;
};

export type ClaimLedgerStoreOpts = {
  readonly stateDir: string;
  readonly now?: Clock;
};

export type PlannedClaimInput = {
  readonly sourceKey: string;
  readonly text: string;
  readonly owner: string;
};

export type ClaimStatusPatch = {
  readonly status: ClaimStatus;
  readonly verifierNote?: string | undefined;
  readonly evidence?: ReadonlyArray<ClaimEvidence> | undefined;
};

export type ClaimLedgerMutationResult = {
  readonly claims: readonly Claim[];
  readonly events: readonly ClaimEvent[];
};

export class MissionStore {
  private readonly stateDir: string;
  private readonly now: Clock;

  constructor(opts: MissionStoreOpts) {
    this.stateDir = opts.stateDir;
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  async ensureMission(task: Task): Promise<MissionPacket> {
    if (existsSync(this.missionPath(task.id))) return this.readMission(task.id);

    const mission = defaultMissionFromTask(task, this.now());
    await writeJsonAtomic(this.missionPath(task.id), mission);
    await appendJsonl(this.eventsPath(task.id), {
      type: "mission.initialized",
      taskId: task.id,
      mission,
      ts: mission.createdAt,
    });
    return mission;
  }

  async readMission(taskId: string): Promise<MissionPacket> {
    const raw = await readJson(this.missionPath(taskId));
    return MissionPacketSchema.parse(raw);
  }

  async updateMission(task: Task, patch: MissionPatch): Promise<MissionPacket> {
    const current = await this.ensureMission(task);
    const parsedPatch = MissionPatchSchema.parse(patch);
    const updatedAt = this.now();
    const next = MissionPacketSchema.parse({
      ...current,
      ...parsedPatch,
      updatedAt,
    });
    await writeJsonAtomic(this.missionPath(task.id), next);
    await appendJsonl(this.eventsPath(task.id), {
      type: "mission.updated",
      taskId: task.id,
      patch: parsedPatch,
      ts: updatedAt,
    });
    return next;
  }

  async listEvents(taskId: string): Promise<MissionEvent[]> {
    return readJsonlValidated(this.eventsPath(taskId), MissionEventSchema);
  }

  private missionPath(taskId: string): string {
    return join(this.stateDir, "tasks", taskId, "mission.json");
  }

  private eventsPath(taskId: string): string {
    return join(this.stateDir, "tasks", taskId, "mission-events.jsonl");
  }
}

export class ClaimLedgerStore {
  private readonly stateDir: string;
  private readonly now: Clock;

  constructor(opts: ClaimLedgerStoreOpts) {
    this.stateDir = opts.stateDir;
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  async listClaims(taskId: string): Promise<Claim[]> {
    return foldClaimEvents(await this.listEvents(taskId));
  }

  async listEvents(taskId: string): Promise<ClaimEvent[]> {
    return readJsonlValidated(this.claimsPath(taskId), ClaimEventSchema);
  }

  async syncPlannedClaims(
    taskId: string,
    plannedClaims: ReadonlyArray<PlannedClaimInput>,
  ): Promise<ClaimLedgerMutationResult> {
    const existing = await this.listClaims(taskId);
    const sourceKeys = new Set(existing.map((claim) => claim.sourceKey));
    const events = plannedClaims
      .filter((claim) => !sourceKeys.has(claim.sourceKey))
      .map((claim) =>
        ClaimEventSchema.parse({
          type: "claim.created",
          claimId: claimIdForSourceKey(taskId, claim.sourceKey),
          taskId,
          sourceKey: claim.sourceKey,
          text: claim.text,
          owner: claim.owner,
          source: "plan",
          createdAt: this.now(),
        }),
      );

    for (const event of events) {
      await appendJsonl(this.claimsPath(taskId), event);
    }
    return {
      claims: await this.listClaims(taskId),
      events,
    };
  }

  async updateClaimStatus(
    taskId: string,
    claimId: string,
    patch: ClaimStatusPatch,
  ): Promise<ClaimLedgerMutationResult> {
    const event = ClaimEventSchema.parse({
      type: "claim.status_changed",
      claimId,
      taskId,
      status: patch.status,
      ...(patch.verifierNote !== undefined ? { verifierNote: patch.verifierNote } : {}),
      ...(patch.evidence !== undefined ? { evidence: [...patch.evidence] } : {}),
      updatedAt: this.now(),
    });
    await appendJsonl(this.claimsPath(taskId), event);
    return {
      claims: await this.listClaims(taskId),
      events: [event],
    };
  }

  private claimsPath(taskId: string): string {
    return join(this.stateDir, "tasks", taskId, "claims.jsonl");
  }
}

export function claimIdForSourceKey(taskId: string, sourceKey: string): string {
  const digest = createHash("sha256")
    .update(taskId)
    .update("\u0000")
    .update(sourceKey)
    .digest("base64url")
    .slice(0, 16);
  return `claim_${digest}`;
}

function defaultMissionFromTask(task: Task, now: string): MissionPacket {
  return MissionPacketSchema.parse({
    taskId: task.id,
    goal: task.title,
    successCriteria: [task.description.trim() || task.title],
    constraints: [],
    riskLevel: "medium",
    workflowIntent: task.workflow ?? "backend-feature",
    affectedAreas: task.tags,
    policyProfile: "medium",
    createdAt: now,
    updatedAt: now,
  });
}

async function readJson(path: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  return parsed;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

async function appendJsonl(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function readJsonlValidated<T>(
  path: string,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
): Promise<T[]> {
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  const events: T[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const parsedJson: unknown = JSON.parse(line);
      const parsed = schema.safeParse(parsedJson);
      if (parsed.success) events.push(parsed.data);
    } catch {
      // Skip torn JSONL writes; the ledger is append-only and recoverable.
    }
  }
  return events;
}
