import { join } from "node:path";
import type { AgentEvent, Phase, Run } from "@pi-harness/shared";
import { mkEventAt } from "../domain/events.js";
import { writerForPath } from "./jsonl-writer.js";

type PhaseEventLogPhase = Extract<Phase, "brainstorm" | "plan">;
export const BRAINSTORM_EVENT_KINDS = [
  "brainstorm_question",
  "brainstorm_answer",
  "brainstorm_system",
  "brainstorm_revision_requested",
  "brainstorm_user_nudge",
  "brainstorm_usage",
  "brainstorm_artifact_edited",
  "brainstorm_agent_reply",
  "brainstorm_mock_proposed",
  "brainstorm_mock_revised",
  "brainstorm_mock_selected",
  "brainstorm_mock_edit_requested",
  "brainstorm_design_promoted",
] as const;
type BrainstormEventKind = (typeof BRAINSTORM_EVENT_KINDS)[number];
type PlanEventKind =
  | "plan_system"
  | "plan_subagent_started"
  | "plan_subagent_ended"
  | "plan_revision_requested"
  | "plan_usage"
  | "plan_artifact_edited";
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export type BrainstormPhaseEventInput = DistributiveOmit<
  Extract<AgentEvent, { kind: BrainstormEventKind }>,
  "id" | "ts" | "runId" | "taskId"
>;
export type PlanPhaseEventInput = DistributiveOmit<
  Extract<AgentEvent, { kind: PlanEventKind }>,
  "id" | "ts" | "runId" | "taskId"
>;
export type PhaseEventInput = BrainstormPhaseEventInput | PlanPhaseEventInput;
export type PhaseEventInputFor<P extends PhaseEventLogPhase> = P extends "brainstorm"
  ? BrainstormPhaseEventInput
  : PlanPhaseEventInput;

export type PhaseEventStore = {
  append(event: AgentEvent): Promise<void>;
};

export type PhaseRunLookup = {
  findActiveRun(taskId: string, phase: PhaseEventLogPhase): Promise<Pick<Run, "id"> | null>;
};

type PublishOptions<P extends PhaseEventLogPhase> = {
  readonly phase: P;
  readonly worktreePath: string;
  readonly taskId: string;
  readonly input: PhaseEventInputFor<P>;
  readonly runId?: string;
  readonly timestamp?: Date;
};

type PublishManyOptions<P extends PhaseEventLogPhase> = {
  readonly phase: P;
  readonly worktreePath: string;
  readonly taskId: string;
  readonly inputs: ReadonlyArray<PhaseEventInputFor<P>>;
  readonly runId?: string;
  readonly timestamp?: Date;
};

export class PhaseEventLogStore {
  constructor(
    private readonly deps: {
      readonly events?: PhaseEventStore;
      readonly runs?: PhaseRunLookup;
    },
  ) {}

  async publish<P extends PhaseEventLogPhase>(
    opts: PublishOptions<P>,
  ): Promise<AgentEvent | null> {
    const [event] = await this.publishMany({
      phase: opts.phase,
      worktreePath: opts.worktreePath,
      taskId: opts.taskId,
      inputs: [opts.input],
      ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
      ...(opts.timestamp !== undefined ? { timestamp: opts.timestamp } : {}),
    });
    return event ?? null;
  }

  async publishMany<P extends PhaseEventLogPhase>(
    opts: PublishManyOptions<P>,
  ): Promise<AgentEvent[]> {
    const runId = opts.runId ?? await this.activeRunId(opts.taskId, opts.phase);
    const events: AgentEvent[] = [];
    for (const input of opts.inputs) {
      const ts = opts.timestamp ?? new Date();
      const event = await this.appendOne({
        phase: opts.phase,
        worktreePath: opts.worktreePath,
        taskId: opts.taskId,
        input,
        ts,
        ...(runId !== null ? { runId } : {}),
      });
      if (event !== null) events.push(event);
    }
    return events;
  }

  private async appendOne<P extends PhaseEventLogPhase>({
    phase,
    worktreePath,
    taskId,
    input,
    ts,
    runId,
  }: {
    readonly phase: P;
    readonly worktreePath: string;
    readonly taskId: string;
    readonly input: PhaseEventInputFor<P>;
    readonly ts: Date;
    readonly runId?: string;
  }): Promise<AgentEvent | null> {
    await writerForPath(phaseLogPath({ worktreePath, taskId, phase })).append({
      ts: ts.toISOString(),
      ...input,
    });
    if (runId === undefined || this.deps.events === undefined) return null;
    const event = mkPhaseEvent({ runId, taskId, ts, input });
    await this.deps.events.append(event);
    return event;
  }

  private async activeRunId(
    taskId: string,
    phase: PhaseEventLogPhase,
  ): Promise<string | null> {
    if (!this.deps.runs || !this.deps.events) return null;
    return (await this.deps.runs.findActiveRun(taskId, phase))?.id ?? null;
  }
}

function phaseLogPath({
  worktreePath,
  taskId,
  phase,
}: {
  readonly worktreePath: string;
  readonly taskId: string;
  readonly phase: PhaseEventLogPhase;
}): string {
  return join(worktreePath, ".harness", taskId, `${phase}.jsonl`);
}

function mkPhaseEvent({
  runId,
  taskId,
  ts,
  input,
}: {
  readonly runId: string;
  readonly taskId: string;
  readonly ts: Date;
  readonly input: PhaseEventInput;
}): AgentEvent {
  return mkEventAt({ runId, taskId, ...input }, ts);
}
