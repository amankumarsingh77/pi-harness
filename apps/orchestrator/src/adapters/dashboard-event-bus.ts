import { randomUUID } from "node:crypto";
import type { DashboardEvent, Run, Task } from "@pi-harness/shared";

type Subscriber = (e: DashboardEvent) => void;
type DashboardEventInput =
  | { kind: "task_updated"; task: Task }
  | { kind: "run_updated"; run: Run };

export class DashboardEventBus {
  private readonly subs = new Set<Subscriber>();

  publishTask(task: Task): void {
    this.publish({ kind: "task_updated", task });
  }

  publishRun(run: Run): void {
    this.publish({ kind: "run_updated", run });
  }

  subscribe(sub: Subscriber): () => void {
    this.subs.add(sub);
    return () => {
      this.subs.delete(sub);
    };
  }

  private publish(input: DashboardEventInput): void {
    const event: DashboardEvent = input.kind === "task_updated"
      ? { id: randomUUID(), ts: new Date(), kind: "task_updated", task: input.task }
      : { id: randomUUID(), ts: new Date(), kind: "run_updated", run: input.run };
    for (const sub of this.subs) sub(event);
  }
}
