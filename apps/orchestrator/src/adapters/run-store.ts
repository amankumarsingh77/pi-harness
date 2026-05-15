import { eq, asc, desc, and, inArray } from "drizzle-orm";
import { tasks, runs, type DbClient } from "@pi-harness/db";
import type { Task, TaskStatus, Run, Phase, TaskPriority } from "@pi-harness/shared";
import { TASK_STATUSES } from "@pi-harness/shared";
import { NotFoundError } from "../domain/errors.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class RunStore {
  constructor(private readonly db: DbClient) {}

  async createTask(input: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    tags?: readonly string[];
  }): Promise<Task> {
    const [row] = await this.db
      .insert(tasks)
      .values({
        title: input.title,
        description: input.description ?? "",
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.tags !== undefined ? { tags: [...input.tags] } : {}),
      })
      .returning();
    return row as Task;
  }

  async getTask(id: string): Promise<Task> {
    // Reject non-UUID ids before they hit Postgres — otherwise pg throws a
    // 22P02 "invalid input syntax for type uuid" which surfaces as a 500.
    // Treat malformed ids as not-found so the dashboard hits its 404 path
    // (e.g., when a stale URL or fixture id like "T-093" is opened).
    if (!UUID_RE.test(id)) throw new NotFoundError("task", id);
    const [row] = await this.db.select().from(tasks).where(eq(tasks.id, id));
    if (!row) throw new NotFoundError("task", id);
    return row as Task;
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<Task> {
    const { tags, ...rest } = patch;
    const [row] = await this.db
      .update(tasks)
      .set({
        ...rest,
        ...(tags !== undefined ? { tags: [...tags] } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id))
      .returning();
    if (!row) throw new NotFoundError("task", id);
    return row as Task;
  }

  async updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
    return this.updateTask(id, { status });
  }

  async listTasks(): Promise<Task[]> {
    const rows = await this.db.select().from(tasks).orderBy(asc(tasks.createdAt));
    return rows as Task[];
  }

  async listTasksByStatus(status: TaskStatus): Promise<Task[]> {
    const rows = await this.db.select().from(tasks).where(eq(tasks.status, status));
    return rows as Task[];
  }

  async countByStatus(): Promise<Record<TaskStatus, number>> {
    const rows = (await this.db.select().from(tasks)) as Task[];
    const init = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
    for (const t of rows) init[t.status]++;
    return init;
  }

  async listActiveRunIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: runs.id })
      .from(runs)
      .where(inArray(runs.status, ["pending", "running"]))
      .orderBy(asc(runs.startedAt));
    return rows.map((r) => r.id);
  }

  async totalCostUsd(): Promise<number> {
    const rows = (await this.db.select({ costUsd: runs.costUsd }).from(runs)) as { costUsd: number }[];
    return rows.reduce((total, r) => total + r.costUsd, 0);
  }

  async createRun(input: { taskId: string; phase: Phase }): Promise<Run> {
    const [row] = await this.db
      .insert(runs)
      .values({ taskId: input.taskId, phase: input.phase })
      .returning();
    return row as Run;
  }

  // Cheap existence check used by the phaseModels freeze gate. LIMIT 1 so we
  // don't pull or count rows we don't need.
  async hasAnyRun(taskId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.taskId, taskId))
      .limit(1);
    return rows.length > 0;
  }

  async getRun(id: string): Promise<Run> {
    if (!UUID_RE.test(id)) throw new NotFoundError("run", id);
    const [row] = await this.db.select().from(runs).where(eq(runs.id, id));
    if (!row) throw new NotFoundError("run", id);
    return row as Run;
  }

  async listRuns(taskId: string): Promise<Run[]> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(eq(runs.taskId, taskId))
      .orderBy(asc(runs.startedAt));
    return rows as Run[];
  }

  // Returns the most recently started non-terminal Run for (taskId, phase),
  // or null. "Non-terminal" = status is pending or running (not succeeded /
  // failed / cancelled). Used by the brainstorm phase to reuse a single Run
  // across the many ticks the script does between user answers.
  async findActiveRun(taskId: string, phase: Phase): Promise<Run | null> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.taskId, taskId),
          eq(runs.phase, phase),
          inArray(runs.status, ["pending", "running"]),
        ),
      )
      .orderBy(desc(runs.startedAt))
      .limit(1);
    return (rows[0] as Run | undefined) ?? null;
  }

  // All non-terminal runs for a task across all phases. Used by user_cancel
  // to settle every active run in one pass.
  async findActiveRunsForTask(taskId: string): Promise<Run[]> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.taskId, taskId),
          inArray(runs.status, ["pending", "running"]),
        ),
      );
    return rows as Run[];
  }

  async updateRun(id: string, patch: Partial<Run>): Promise<Run> {
    const [row] = await this.db.update(runs).set(patch).where(eq(runs.id, id)).returning();
    if (!row) throw new NotFoundError("run", id);
    return row as Run;
  }
}
