import { rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../../src/adapters/event-store.js";
import { LiveEventStore } from "../../src/adapters/live-event-store.js";
import { RunStore } from "../../src/adapters/run-store.js";

export function createTestStores(): {
  readonly stateDir: string;
  readonly runs: RunStore;
  readonly events: EventStore;
  readonly liveEvents: LiveEventStore;
} {
  const stateDir = mkdtempSync(join(tmpdir(), "pi-harness-state-"));
  const liveEvents = new LiveEventStore({ stateDir });
  const runs = new RunStore({ stateDir }, {
    onTaskChanged: (task) => liveEvents.publishTask(task),
    onRunChanged: (run) => liveEvents.publishRun(run),
  });
  const events = new EventStore({ stateDir }, liveEvents);
  return { stateDir, runs, events, liveEvents };
}

export function createBareTestStores(): {
  readonly stateDir: string;
  readonly runs: RunStore;
  readonly events: EventStore;
} {
  const stateDir = mkdtempSync(join(tmpdir(), "pi-harness-state-"));
  return {
    stateDir,
    runs: new RunStore({ stateDir }),
    events: new EventStore({ stateDir }),
  };
}

export async function resetTestStore(stateDir: string): Promise<void> {
  await rm(join(stateDir, "store"), { recursive: true, force: true });
}
