import { join } from "node:path";
import type { AgentEvent } from "@pi-harness/shared";
import { appendJsonl, readJsonl } from "./jsonl-writer.js";
import type { LiveEventStore } from "./live-event-store.js";

type Subscriber = (e: AgentEvent) => void;

export type EventStoreOpts = {
  readonly stateDir: string;
};

type SerializedAgentEvent = Omit<AgentEvent, "ts"> & {
  readonly ts: string;
};

export class EventStore {
  private readonly subs = new Map<string, Set<Subscriber>>();
  private readonly eventLogPath: string;

  constructor(
    opts: EventStoreOpts,
    private readonly liveEvents?: LiveEventStore,
  ) {
    this.eventLogPath = join(opts.stateDir, "store", "agent-events.jsonl");
  }

  async append(e: AgentEvent): Promise<void> {
    await appendJsonl(this.eventLogPath, serializeAgentEvent(e));

    const subs = this.subs.get(e.runId);
    if (subs) {
      for (const sub of subs) sub(e);
    }
    await this.liveEvents?.publishAgentEvent(e);
  }

  async listForRun(runId: string): Promise<AgentEvent[]> {
    return (await this.listAll()).filter((event) => event.runId === runId);
  }

  async listForRunAfter(runId: string, afterId: string | null): Promise<AgentEvent[]> {
    const all = await this.listForRun(runId);
    if (afterId === null) return all;
    const idx = all.findIndex((e) => e.id === afterId);
    return idx === -1 ? all : all.slice(idx + 1);
  }

  async latestEventAt(): Promise<Date | null> {
    return [...(await this.listAll())].sort((a, b) => b.ts.getTime() - a.ts.getTime())[0]?.ts ?? null;
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

  private async listAll(): Promise<AgentEvent[]> {
    return (await readJsonl<unknown>(this.eventLogPath))
      .map(parseAgentEvent)
      .filter((event): event is AgentEvent => event !== null)
      .sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }
}

function serializeAgentEvent(event: AgentEvent): SerializedAgentEvent {
  return {
    ...event,
    ts: event.ts.toISOString(),
  };
}

function parseAgentEvent(value: unknown): AgentEvent | null {
  if (!isRecord(value)) return null;
  const ts = parseDate(value["ts"]);
  if (
    !ts ||
    typeof value["id"] !== "string" ||
    typeof value["runId"] !== "string" ||
    typeof value["taskId"] !== "string" ||
    typeof value["kind"] !== "string"
  ) {
    return null;
  }
  return {
    ...value,
    id: value["id"],
    runId: value["runId"],
    taskId: value["taskId"],
    kind: value["kind"],
    ts,
  } as AgentEvent;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
