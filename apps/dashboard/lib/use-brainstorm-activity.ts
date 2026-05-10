"use client";
import { useEffect, useMemo, useState } from "react";
import { useBrainstormEvents } from "./brainstorm-events-context";
import { deriveActivity, type ActivityState } from "@/components/brainstorm/activity-line";

// Live activity signal for the brainstorm phase. `true` while a tool_call
// without a matching tool_result is in flight (or "thinking" — same idea, the
// agent is mid-tick). `false` when no tick is active. Reads from the page's
// shared SSE subscription (BrainstormEventsProvider) so the artifact pane can
// dim itself without opening its own EventSource.
export function useBrainstormActivity(runId: string | null): boolean {
  const { events } = useBrainstormEvents();
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const activity: ActivityState = useMemo(() => {
    if (runId === null) return null;
    return deriveActivity(events, nowMs);
  }, [events, nowMs, runId]);
  return activity !== null;
}
