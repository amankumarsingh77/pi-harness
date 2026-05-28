import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Phase, Run, Task, TaskPriority, TaskStatus } from "@pi-harness/shared";
import { TASK_STATUSES } from "@pi-harness/shared";
import { NotFoundError } from "../domain/errors.js";
import { appendJsonl, readJsonl } from "./jsonl-writer.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RunStoreObserver = {
  onTaskChanged?: (task: Task) => void | Promise<void>;
  onRunChanged?: (run: Run) => void | Promise<void>;
};

export type RunStoreOpts = {
  readonly stateDir: string;
};

type TaskEntry = {
  readonly type: "task.upsert";
  readonly task: SerializedTask;
};

type RunEntry = {
  readonly type: "run.upsert";
  readonly run: SerializedRun;
};

type SerializedTask = Omit<Task, "createdAt" | "updatedAt"> & {
  readonly createdAt: string;
  readonly updatedAt: string;
};

type SerializedRun = Omit<Run, "startedAt" | "endedAt"> & {
  readonly startedAt: string;
  readonly endedAt: string | null;
};

export class RunStore {
  private readonly taskLogPath: string;
  private readonly runLogPath: string;

  constructor(
    opts: RunStoreOpts,
    private readonly observer: RunStoreObserver = {},
  ) {
    this.taskLogPath = join(opts.stateDir, "store", "tasks.jsonl");
    this.runLogPath = join(opts.stateDir, "store", "runs.jsonl");
  }

  async createTask(input: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    tags?: readonly string[];
  }): Promise<Task> {
    const now = new Date();
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      description: input.description ?? "",
      status: "backlog",
      workflow: null,
      worktreePath: null,
      branchName: null,
      retryCount: 0,
      priority: input.priority ?? "none",
      tags: [...(input.tags ?? [])],
      phaseModels: {},
      createdAt: now,
      updatedAt: now,
    };
    await this.writeTask(task);
    return task;
  }

  async getTask(id: string): Promise<Task> {
    if (!UUID_RE.test(id)) throw new NotFoundError("task", id);
    const task = (await this.taskMap()).get(id);
    if (!task) throw new NotFoundError("task", id);
    return task;
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<Task> {
    const current = await this.getTask(id);
    const updated: Task = {
      ...current,
      ...patch,
      tags: patch.tags !== undefined ? [...patch.tags] : current.tags,
      updatedAt: new Date(),
    };
    await this.writeTask(updated);
    return updated;
  }

  async listTasks(): Promise<Task[]> {
    return [...(await this.taskMap()).values()].sort(byDate((task) => task.createdAt));
  }

  async listTasksByStatus(status: TaskStatus): Promise<Task[]> {
    return (await this.listTasks()).filter((task) => task.status === status);
  }

  async countByStatus(): Promise<Record<TaskStatus, number>> {
    const init = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<TaskStatus, number>;
    return (await this.listTasks()).reduce(
      (counts, task) => ({ ...counts, [task.status]: counts[task.status] + 1 }),
      init,
    );
  }

  async listActiveRunIds(): Promise<string[]> {
    return (await this.listAllRuns())
      .filter((run) => run.status === "pending" || run.status === "running")
      .map((run) => run.id);
  }

  async totalCostUsd(): Promise<number> {
    return (await this.listAllRuns()).reduce((total, run) => total + run.costUsd, 0);
  }

  async createRun(input: { taskId: string; phase: Phase }): Promise<Run> {
    const now = new Date();
    const run: Run = {
      id: randomUUID(),
      taskId: input.taskId,
      phase: input.phase,
      status: "pending",
      startedAt: now,
      endedAt: null,
      error: null,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      piSessionPath: null,
    };
    await this.writeRun(run);
    return run;
  }

  async hasAnyRun(taskId: string): Promise<boolean> {
    return (await this.listRuns(taskId)).length > 0;
  }

  async getRun(id: string): Promise<Run> {
    if (!UUID_RE.test(id)) throw new NotFoundError("run", id);
    const run = (await this.runMap()).get(id);
    if (!run) throw new NotFoundError("run", id);
    return run;
  }

  async listRuns(taskId: string): Promise<Run[]> {
    return (await this.listAllRuns()).filter((run) => run.taskId === taskId);
  }

  async listAllRuns(): Promise<Run[]> {
    return [...(await this.runMap()).values()].sort(byDate((run) => run.startedAt));
  }

  async findActiveRun(taskId: string, phase: Phase): Promise<Run | null> {
    return latestRun(
      (await this.listRuns(taskId)).filter(
        (run) => run.phase === phase && (run.status === "pending" || run.status === "running"),
      ),
    );
  }

  async findLatestRun(taskId: string, phase: Phase, status: Run["status"]): Promise<Run | null> {
    return latestRun(
      (await this.listRuns(taskId)).filter((run) => run.phase === phase && run.status === status),
    );
  }

  async isPhasePausedByCancellation(taskId: string, phase: Phase): Promise<boolean> {
    const active = await this.findActiveRun(taskId, phase);
    if (active) return false;
    const latest = latestRun((await this.listRuns(taskId)).filter((run) => run.phase === phase));
    return latest?.status === "cancelled";
  }

  async findActiveRunsForTask(taskId: string): Promise<Run[]> {
    return (await this.listRuns(taskId)).filter(
      (run) => run.status === "pending" || run.status === "running",
    );
  }

  async updateRun(id: string, patch: Partial<Run>): Promise<Run> {
    const current = await this.getRun(id);
    const updated: Run = { ...current, ...patch };
    await this.writeRun(updated);
    return updated;
  }

  private async writeTask(task: Task): Promise<void> {
    await appendJsonl(this.taskLogPath, { type: "task.upsert", task: serializeTask(task) });
    await this.observer.onTaskChanged?.(task);
  }

  private async writeRun(run: Run): Promise<void> {
    await appendJsonl(this.runLogPath, { type: "run.upsert", run: serializeRun(run) });
    await this.observer.onRunChanged?.(run);
  }

  private async taskMap(): Promise<Map<string, Task>> {
    return foldById(await readJsonl<unknown>(this.taskLogPath), parseTaskEntry);
  }

  private async runMap(): Promise<Map<string, Run>> {
    return foldById(await readJsonl<unknown>(this.runLogPath), parseRunEntry);
  }
}

function foldById<T extends { readonly id: string }>(
  rows: readonly unknown[],
  parse: (row: unknown) => T | null,
): Map<string, T> {
  let map = new Map<string, T>();
  for (const row of rows) {
    const parsed = parse(row);
    if (parsed) map = new Map([...map, [parsed.id, parsed]]);
  }
  return map;
}

function parseTaskEntry(row: unknown): Task | null {
  if (!isRecord(row) || row["type"] !== "task.upsert") return null;
  return parseTask(row["task"]);
}

function parseRunEntry(row: unknown): Run | null {
  if (!isRecord(row) || row["type"] !== "run.upsert") return null;
  return parseRun(row["run"]);
}

function parseTask(value: unknown): Task | null {
  if (!isRecord(value)) return null;
  const createdAt = parseDate(value["createdAt"]);
  const updatedAt = parseDate(value["updatedAt"]);
  if (!createdAt || !updatedAt) return null;
  if (
    typeof value["id"] !== "string" ||
    typeof value["title"] !== "string" ||
    typeof value["description"] !== "string" ||
    typeof value["status"] !== "string" ||
    typeof value["retryCount"] !== "number" ||
    typeof value["priority"] !== "string" ||
    !Array.isArray(value["tags"])
  ) {
    return null;
  }
  return {
    id: value["id"],
    title: value["title"],
    description: value["description"],
    status: value["status"] as TaskStatus,
    workflow: value["workflow"] === "backend-feature" ? value["workflow"] : null,
    worktreePath: typeof value["worktreePath"] === "string" ? value["worktreePath"] : null,
    branchName: typeof value["branchName"] === "string" ? value["branchName"] : null,
    retryCount: value["retryCount"],
    priority: value["priority"] as TaskPriority,
    tags: value["tags"].filter((tag): tag is string => typeof tag === "string"),
    phaseModels: isRecord(value["phaseModels"]) ? value["phaseModels"] : {},
    createdAt,
    updatedAt,
  };
}

function parseRun(value: unknown): Run | null {
  if (!isRecord(value)) return null;
  const startedAt = parseDate(value["startedAt"]);
  const endedAt = value["endedAt"] === null ? null : parseDate(value["endedAt"]);
  if (!startedAt || endedAt === undefined) return null;
  if (
    typeof value["id"] !== "string" ||
    typeof value["taskId"] !== "string" ||
    typeof value["phase"] !== "string" ||
    typeof value["status"] !== "string" ||
    typeof value["costUsd"] !== "number" ||
    typeof value["inputTokens"] !== "number" ||
    typeof value["outputTokens"] !== "number"
  ) {
    return null;
  }
  return {
    id: value["id"],
    taskId: value["taskId"],
    phase: value["phase"] as Phase,
    status: value["status"] as Run["status"],
    startedAt,
    endedAt,
    error: typeof value["error"] === "string" ? value["error"] : null,
    costUsd: value["costUsd"],
    inputTokens: value["inputTokens"],
    outputTokens: value["outputTokens"],
    piSessionPath: typeof value["piSessionPath"] === "string" ? value["piSessionPath"] : null,
  };
}

function serializeTask(task: Task): SerializedTask {
  return {
    ...task,
    tags: [...task.tags],
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function serializeRun(run: Run): SerializedRun {
  return {
    ...run,
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt?.toISOString() ?? null,
  };
}

function latestRun(runs: readonly Run[]): Run | null {
  return [...runs].sort(byDateDesc((run) => run.startedAt))[0] ?? null;
}

function byDate<T>(getDate: (item: T) => Date): (a: T, b: T) => number {
  return (a, b) => getDate(a).getTime() - getDate(b).getTime();
}

function byDateDesc<T>(getDate: (item: T) => Date): (a: T, b: T) => number {
  return (a, b) => getDate(b).getTime() - getDate(a).getTime();
}

function parseDate(value: unknown): Date | null | undefined {
  if (value === null) return undefined;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
