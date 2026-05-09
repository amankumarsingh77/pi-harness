import { eq, asc } from "drizzle-orm";
import { events as eventsTable } from "@pi-harness/db";
import type { AgentEvent } from "@pi-harness/shared";

type Subscriber = (e: AgentEvent) => void;

// Persists every AgentEvent to Postgres and pushes a copy to in-process
// subscribers. The SSE handler subscribes here; the dashboard "live log" is
// just a tail of these.
//
// Note: in-process pub/sub means a multi-instance deployment would miss events
// across replicas. v1 runs a single orchestrator. v2: pg LISTEN/NOTIFY or Redis.
export class EventStore {
  private readonly subs = new Map<string, Set<Subscriber>>(); // runId → subs

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly db: any) {}

  async append(e: AgentEvent): Promise<void> {
    // Map AgentEvent → row. The row stores `kind` and stuffs the rest into
    // `payload` JSONB so we don't need a column per event variant.
    const { id, runId, taskId, ts, kind, ...rest } = e as AgentEvent & Record<string, unknown>;
    await this.db.insert(eventsTable).values({
      id,
      runId,
      taskId,
      ts,
      kind,
      payload: rest,
    });

    const subs = this.subs.get(runId);
    if (subs) {
      for (const sub of subs) sub(e);
    }
  }

  async listForRun(runId: string): Promise<AgentEvent[]> {
    const rows = await this.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.runId, runId))
      .orderBy(asc(eventsTable.ts));
    return rows.map((r: { id: string; runId: string; taskId: string; ts: Date; kind: string; payload: Record<string, unknown> }) => ({
      id: r.id,
      runId: r.runId,
      taskId: r.taskId,
      ts: r.ts,
      kind: r.kind,
      ...r.payload,
    })) as AgentEvent[];
  }

  subscribe(runId: string, sub: Subscriber): () => void {
    let set = this.subs.get(runId);
    if (!set) {
      set = new Set();
      this.subs.set(runId, set);
    }
    set.add(sub);
    return () => {
      set!.delete(sub);
      if (set!.size === 0) this.subs.delete(runId);
    };
  }
}
