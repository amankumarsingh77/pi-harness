import type {
  AgentEvent,
  LiveEventEnvelope,
  LiveEventKind,
} from "@pi-harness/shared";

type AnyLiveEventEnvelope = {
  readonly [K in LiveEventKind]: LiveEventEnvelope<K>;
}[LiveEventKind];

export type LiveStreamFilter =
  | { readonly scope: "dashboard"; readonly taskId?: never; readonly runId?: never }
  | { readonly taskId: string; readonly scope?: never; readonly runId?: never }
  | { readonly runId: string; readonly scope?: never; readonly taskId?: never };

export function buildLiveStreamUrl(
  filter: LiveStreamFilter,
  opts: { readonly afterSequence?: number } = {},
): string {
  const params = new URLSearchParams();
  if ("scope" in filter) params.set("scope", filter.scope);
  if ("taskId" in filter) params.set("taskId", filter.taskId);
  if ("runId" in filter) params.set("runId", filter.runId);
  if (opts.afterSequence !== undefined && opts.afterSequence > 0) {
    params.set("after", String(opts.afterSequence));
  }
  return `/api/live/stream?${params.toString()}`;
}

export function parseLiveEnvelope<K extends LiveEventEnvelope["kind"]>(
  raw: string,
  kind: K,
): LiveEventEnvelope<K> | null {
  const parsed = parseJson(raw);
  if (!isLiveEventEnvelopeKind(parsed, kind)) return null;
  return hydrateLiveEnvelope(parsed) as LiveEventEnvelope<K>;
}

export function hydrateLiveEnvelope<K extends LiveEventEnvelope["kind"]>(
  envelope: LiveEventEnvelope<K>,
): LiveEventEnvelope<K> {
  return hydrateAnyLiveEnvelope(envelope as AnyLiveEventEnvelope) as LiveEventEnvelope<K>;
}

export function mergeLiveEnvelopes(
  initial: readonly LiveEventEnvelope[],
  incoming: readonly LiveEventEnvelope[],
): LiveEventEnvelope[] {
  const byId = new Map<string, LiveEventEnvelope>();
  for (const event of initial) byId.set(event.id, hydrateLiveEnvelope(event));
  for (const event of incoming) byId.set(event.id, hydrateLiveEnvelope(event));
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
}

export function hydrateAgentEvent(event: AgentEvent): AgentEvent {
  return { ...event, ts: toDate(event.ts) };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hydrateAnyLiveEnvelope(envelope: AnyLiveEventEnvelope): AnyLiveEventEnvelope {
  if (envelope.kind === "agent.event.appended") {
    return {
      ...envelope,
      ts: toDate(envelope.ts),
      payload: hydrateAgentEvent(envelope.payload),
    };
  }
  return {
    ...envelope,
    ts: toDate(envelope.ts),
  };
}

function isLiveEventEnvelope(value: unknown): value is LiveEventEnvelope {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    hasNumber(value, "sequence") &&
    hasString(value, "scope") &&
    hasString(value, "kind") &&
    "ts" in value &&
    "payload" in value
  );
}

function isLiveEventEnvelopeKind<K extends LiveEventEnvelope["kind"]>(
  value: unknown,
  kind: K,
): value is LiveEventEnvelope<K> {
  return isLiveEventEnvelope(value) && value.kind === kind;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function hasString(value: Readonly<Record<string, unknown>>, key: string): boolean {
  return typeof value[key] === "string";
}

function hasNumber(value: Readonly<Record<string, unknown>>, key: string): boolean {
  return typeof value[key] === "number";
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
