import { join } from "node:path";
import type { PreflightStep, PreflightStepStatus } from "@pi-harness/shared";
import { appendJsonl, readJsonl } from "./jsonl-writer.js";

type SerializedPreflightStep = Omit<PreflightStep, "startedAt" | "endedAt"> & {
  readonly startedAt: string;
  readonly endedAt: string | null;
};

type PreflightStepEntry = {
  readonly type: "preflight_step.upsert";
  readonly step: SerializedPreflightStep;
};

export type PreflightStepStoreOpts = {
  readonly stateDir: string;
};

export class PreflightStepStore {
  private readonly logPath: string;

  constructor(opts: PreflightStepStoreOpts) {
    this.logPath = join(opts.stateDir, "store", "preflight-steps.jsonl");
  }

  async upsert(step: PreflightStep): Promise<PreflightStep> {
    await appendJsonl(this.logPath, {
      type: "preflight_step.upsert",
      step: serializeStep(step),
    });
    return step;
  }

  async listForTask(taskId: string): Promise<PreflightStep[]> {
    return (await this.listAll()).filter((step) => step.taskId === taskId);
  }

  async listForRun(runId: string): Promise<PreflightStep[]> {
    return (await this.listAll()).filter((step) => step.runId === runId);
  }

  async latestForRun(runId: string): Promise<PreflightStep[]> {
    return latestSteps(await this.listForRun(runId));
  }

  async listAll(): Promise<PreflightStep[]> {
    const parsed = (await readJsonl<unknown>(this.logPath))
      .map(parseEntry)
      .filter((step): step is PreflightStep => step !== null);
    return latestSteps(parsed).sort(byStartedAt);
  }
}

export function latestSteps(steps: readonly PreflightStep[]): PreflightStep[] {
  const map = new Map<string, PreflightStep>();
  for (const step of steps) {
    map.set(stepKey(step), step);
  }
  return [...map.values()];
}

function stepKey(step: Pick<PreflightStep, "runId" | "attemptId" | "subagent">): string {
  return `${step.runId}\0${step.attemptId}\0${step.subagent}`;
}

function serializeStep(step: PreflightStep): SerializedPreflightStep {
  return {
    ...step,
    startedAt: step.startedAt.toISOString(),
    endedAt: step.endedAt?.toISOString() ?? null,
  };
}

function parseEntry(row: unknown): PreflightStep | null {
  if (!isRecord(row) || row["type"] !== "preflight_step.upsert") return null;
  return parseStep(row["step"]);
}

function parseStep(value: unknown): PreflightStep | null {
  if (!isRecord(value)) return null;
  const startedAt = parseDate(value["startedAt"]);
  const endedAt = value["endedAt"] === null ? null : parseDate(value["endedAt"]);
  if (!startedAt || endedAt === undefined) return null;
  if (
    typeof value["taskId"] !== "string" ||
    typeof value["runId"] !== "string" ||
    typeof value["attemptId"] !== "string" ||
    typeof value["subagent"] !== "string" ||
    !isPreflightStepStatus(value["status"]) ||
    typeof value["required"] !== "boolean" ||
    typeof value["artifactPath"] !== "string" ||
    typeof value["costUsd"] !== "number" ||
    typeof value["inputTokens"] !== "number" ||
    typeof value["outputTokens"] !== "number"
  ) {
    return null;
  }
  return {
    taskId: value["taskId"],
    runId: value["runId"],
    attemptId: value["attemptId"],
    subagent: value["subagent"],
    status: value["status"],
    required: value["required"],
    artifactPath: value["artifactPath"],
    startedAt,
    endedAt,
    costUsd: value["costUsd"],
    inputTokens: value["inputTokens"],
    outputTokens: value["outputTokens"],
    error: typeof value["error"] === "string" ? value["error"] : null,
    fallbackReason: typeof value["fallbackReason"] === "string" ? value["fallbackReason"] : null,
  };
}

function isPreflightStepStatus(value: unknown): value is PreflightStepStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "timed_out" ||
    value === "cancelled" ||
    value === "skipped" ||
    value === "fallback_succeeded"
  );
}

function parseDate(value: unknown): Date | null | undefined {
  if (value === null) return undefined;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function byStartedAt(a: PreflightStep, b: PreflightStep): number {
  return a.startedAt.getTime() - b.startedAt.getTime();
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
