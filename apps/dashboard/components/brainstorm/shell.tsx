"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import type { AgentEvent, Artifact, Task } from "@pi-harness/shared";
import type { BrainstormGate, BrainstormJsonlEvent } from "@/lib/api";
import { useBrainstormEvents } from "@/lib/brainstorm-events-context";
import { BrainstormHeader } from "./header";
import { EventRail } from "./event-rail";
import { FocusStage } from "./focus-stage";
import { Workpad } from "./workpad";
import { useBrainstormTimeline } from "./use-brainstorm-timeline";

type ResizeSide = "rail" | "workpad";

type BrainstormPanelWidths = {
  readonly rail: number;
  readonly workpad: number;
};

type ActiveResize = {
  readonly side: ResizeSide;
  readonly startX: number;
  readonly startWidths: BrainstormPanelWidths;
};

const DEFAULT_PANEL_WIDTHS: BrainstormPanelWidths = { rail: 280, workpad: 380 };
const RAIL_MIN_WIDTH = 220;
const RAIL_MAX_WIDTH = 480;
const WORKPAD_MIN_WIDTH = 300;
const WORKPAD_MAX_WIDTH = 560;
const FOCUS_MIN_WIDTH = 360;
const RESIZER_WIDTH = 10;
const RESIZER_TOTAL_WIDTH = RESIZER_WIDTH * 2;
const KEYBOARD_RESIZE_STEP = 24;

export function BrainstormShell({
  task,
  runId,
  gate,
  design,
  spec,
  initialEvents,
  initialAgentEvents,
  canCancel,
  cancelled,
}: {
  readonly task: Task;
  readonly runId: string | null;
  readonly gate: BrainstormGate;
  readonly design: Artifact | null;
  readonly spec: Artifact | null;
  readonly initialEvents: ReadonlyArray<BrainstormJsonlEvent>;
  readonly initialAgentEvents: ReadonlyArray<AgentEvent>;
  readonly canCancel: boolean;
  readonly cancelled: boolean;
}) {
  const router = useRouter();
  const { events: liveEvents, connected } = useBrainstormEvents();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [jumpCommitSha, setJumpCommitSha] = useState<string | null>(null);
  const [panelWidths, setPanelWidths] = useState<BrainstormPanelWidths>(DEFAULT_PANEL_WIDTHS);
  const [activeResize, setActiveResize] = useState<ActiveResize | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (!activeResize) return;

    const handlePointerMove = (event: PointerEvent): void => {
      const grid = gridRef.current;
      if (!grid) return;
      setPanelWidths(
        resizePanelWidths({
          side: activeResize.side,
          widths: activeResize.startWidths,
          deltaX: event.clientX - activeResize.startX,
          containerWidth: grid.getBoundingClientRect().width,
        }),
      );
    };

    const handlePointerUp = (): void => setActiveResize(null);

    document.body.classList.add("is-brainstorm-resizing");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      document.body.classList.remove("is-brainstorm-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [activeResize]);

  const gateRelevantCount = timeline.events.filter(isGateRelevant).length;
  const priorGateRelevantCount = useRef(gateRelevantCount);
  useEffect(() => {
    if (gateRelevantCount > priorGateRelevantCount.current) router.refresh();
    priorGateRelevantCount.current = gateRelevantCount;
  }, [gateRelevantCount, router]);

  const startResize = (side: ResizeSide, event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setActiveResize({ side, startX: event.clientX, startWidths: panelWidths });
  };

  const resizeFromKeyboard = (side: ResizeSide, event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    const deltaX = keyboardResizeDelta(event.key);
    if (deltaX === null) return;
    event.preventDefault();

    const grid = gridRef.current;
    if (!grid) return;
    setPanelWidths((widths) =>
      resizePanelWidths({
        side,
        widths,
        deltaX,
        containerWidth: grid.getBoundingClientRect().width,
      }),
    );
  };

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
        canCancel={canCancel}
        cancelled={cancelled}
      />
      <div
        ref={gridRef}
        className="brainstorm-grid"
        data-testid="brainstorm-grid"
        style={{ gridTemplateColumns: brainstormGridTemplate(panelWidths) }}
      >
        <EventRail
          rows={timeline.railRows}
          pinnedBlocked={timeline.pinnedBlocked}
          health={timeline.health}
          jumpCommitSha={jumpCommitSha}
        />
        <BrainstormGridResizer
          label="Resize event rail"
          value={panelWidths.rail}
          min={RAIL_MIN_WIDTH}
          max={RAIL_MAX_WIDTH}
          active={activeResize?.side === "rail"}
          onPointerDown={(event) => startResize("rail", event)}
          onKeyDown={(event) => resizeFromKeyboard("rail", event)}
        />
        <FocusStage taskId={task.id} taskStatus={task.status} timeline={timeline} />
        <BrainstormGridResizer
          label="Resize workpad"
          value={panelWidths.workpad}
          min={WORKPAD_MIN_WIDTH}
          max={WORKPAD_MAX_WIDTH}
          active={activeResize?.side === "workpad"}
          onPointerDown={(event) => startResize("workpad", event)}
          onKeyDown={(event) => resizeFromKeyboard("workpad", event)}
        />
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

function BrainstormGridResizer({
  label,
  value,
  min,
  max,
  active,
  onPointerDown,
  onKeyDown,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly active: boolean;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`brainstorm-grid-resizer ${active ? "is-active" : ""}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}

function brainstormGridTemplate(widths: BrainstormPanelWidths): string {
  return `${widths.rail}px ${RESIZER_WIDTH}px minmax(${FOCUS_MIN_WIDTH}px, 1fr) ${RESIZER_WIDTH}px ${widths.workpad}px`;
}

function keyboardResizeDelta(key: string): number | null {
  if (key === "ArrowLeft") return -KEYBOARD_RESIZE_STEP;
  if (key === "ArrowRight") return KEYBOARD_RESIZE_STEP;
  return null;
}

function resizePanelWidths({
  side,
  widths,
  deltaX,
  containerWidth,
}: {
  readonly side: ResizeSide;
  readonly widths: BrainstormPanelWidths;
  readonly deltaX: number;
  readonly containerWidth: number;
}): BrainstormPanelWidths {
  if (side === "rail") {
    return {
      ...widths,
      rail: clamp(
        widths.rail + deltaX,
        RAIL_MIN_WIDTH,
        maxPanelWidth(containerWidth, widths.workpad, RAIL_MIN_WIDTH, RAIL_MAX_WIDTH),
      ),
    };
  }

  return {
    ...widths,
    workpad: clamp(
      widths.workpad - deltaX,
      WORKPAD_MIN_WIDTH,
      maxPanelWidth(containerWidth, widths.rail, WORKPAD_MIN_WIDTH, WORKPAD_MAX_WIDTH),
    ),
  };
}

function maxPanelWidth(
  containerWidth: number,
  oppositePanelWidth: number,
  minWidth: number,
  maxWidth: number,
): number {
  const layoutMax = containerWidth - oppositePanelWidth - FOCUS_MIN_WIDTH - RESIZER_TOTAL_WIDTH;
  return Math.max(minWidth, Math.min(maxWidth, layoutMax));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
