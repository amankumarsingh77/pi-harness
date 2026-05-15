"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentEvent, Artifact, Task } from "@pi-harness/shared";
import type { BrainstormGate, BrainstormJsonlEvent } from "@/lib/api";
import { useBrainstormEvents } from "@/lib/brainstorm-events-context";
import { BrainstormHeader } from "./header";
import { EventRail } from "./event-rail";
import { FocusStage } from "./focus-stage";
import { Workpad } from "./workpad";
import { useBrainstormTimeline } from "./use-brainstorm-timeline";

export function BrainstormShell({
  task,
  runId,
  gate,
  design,
  spec,
  initialEvents,
  initialAgentEvents,
}: {
  readonly task: Task;
  readonly runId: string | null;
  readonly gate: BrainstormGate;
  readonly design: Artifact | null;
  readonly spec: Artifact | null;
  readonly initialEvents: ReadonlyArray<BrainstormJsonlEvent>;
  readonly initialAgentEvents: ReadonlyArray<AgentEvent>;
}) {
  const router = useRouter();
  const { events: liveEvents, connected } = useBrainstormEvents();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [jumpCommitSha, setJumpCommitSha] = useState<string | null>(null);
  const timeline = useBrainstormTimeline({
    initialEvents,
    initialAgentEvents,
    liveEvents,
    connected,
    taskStatus: task.status,
    gate,
    runId,
    nowMs,
  });

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const gateRelevantCount = timeline.events.filter(isGateRelevant).length;
  const priorGateRelevantCount = useRef(gateRelevantCount);
  useEffect(() => {
    if (gateRelevantCount > priorGateRelevantCount.current) router.refresh();
    priorGateRelevantCount.current = gateRelevantCount;
  }, [gateRelevantCount, router]);

  return (
    <section className="brainstorm-shell">
      <BrainstormHeader
        task={task}
        usage={timeline.usage}
        activity={timeline.activity}
        activityStartedAtMs={timeline.activityStartedAtMs}
        nowMs={nowMs}
        health={timeline.health}
        pastBrainstorm={timeline.pastBrainstorm}
        failed={timeline.failed}
      />
      <div className="brainstorm-grid">
        <EventRail
          rows={timeline.railRows}
          pinnedBlocked={timeline.pinnedBlocked}
          health={timeline.health}
          jumpCommitSha={jumpCommitSha}
        />
        <FocusStage taskId={task.id} taskStatus={task.status} timeline={timeline} />
        <Workpad
          taskId={task.id}
          taskStatus={task.status}
          gate={gate}
          runId={runId}
          design={design}
          spec={spec}
          timeline={timeline}
          onJumpToCommit={setJumpCommitSha}
        />
      </div>
    </section>
  );
}

function isGateRelevant(event: BrainstormJsonlEvent): boolean {
  return (
    (event.kind === "brainstorm_system" && event.systemKind === "status_changed") ||
    event.kind === "brainstorm_revision_requested" ||
    event.kind === "brainstorm_mock_proposed" ||
    event.kind === "brainstorm_mock_revised" ||
    event.kind === "brainstorm_mock_selected"
  );
}
