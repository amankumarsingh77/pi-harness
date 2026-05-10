import { randomUUID } from "node:crypto";
import type { AgentEvent } from "@pi-harness/shared";

// Distributed Omit: applied per-variant so discriminator-keyed fields survive.
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

// Input to mkEvent: every AgentEvent variant, minus the envelope fields the
// builder fills in (id + ts). Deriving from AgentEvent — instead of
// re-declaring a parallel union — keeps this in lockstep with the canonical
// type in @pi-harness/shared.
export type MkEventInput = DistributiveOmit<AgentEvent, "id" | "ts">;

export function mkEvent(input: MkEventInput): AgentEvent {
  return { id: randomUUID(), ts: new Date(), ...input } as AgentEvent;
}
