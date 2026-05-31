"use client";
import { type ReactNode } from "react";
import type { AgentEvent } from "@pi-harness/shared";
import { RunLiveProvider, useRunLiveEvents } from "./run-live-provider";

// Single SSE subscription for the code page. Unlike plan/brainstorm, the code
// page derives all of its state (node statuses, transcripts, metrics) directly
// from the live event stream and reads the execution-dag artifact once at load,
// so there is no bundle to invalidate — this wrapper is just RunLiveProvider.

export function CodeEventsProvider({
  runId,
  initialEvents = [],
  children,
}: {
  readonly runId: string | null;
  readonly initialEvents?: readonly AgentEvent[];
  readonly children: ReactNode;
}) {
  return (
    <RunLiveProvider runId={runId} initialEvents={initialEvents}>
      {children}
    </RunLiveProvider>
  );
}

export function useCodeEvents() {
  return useRunLiveEvents();
}
