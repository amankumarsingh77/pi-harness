import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MissionCommandLive } from "@/components/mission/mission-command-live";
import type { Claim, MissionPacket, Task } from "@pi-harness/shared";

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly listeners = new Map<string, Array<(ev: MessageEvent<string>) => void>>();
  readonly url: string;
  closed = false;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (ev: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent<string>);
    }
  }

  close(): void {
    this.closed = true;
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  // @ts-expect-error test EventSource shim
  globalThis.EventSource = MockEventSource;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/mission")) {
      return Response.json({ mission: mission(), claims: [claim()], events: [], claimEvents: [] });
    }
    return Response.json({ task: task(), runs: [] });
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MissionCommandLive", () => {
  it("hydrates initial mission data and subscribes to the task live stream", () => {
    renderLive();

    expect(screen.getByText("Initial goal")).toBeInTheDocument();
    expect(MockEventSource.instances[0]?.url).toBe("/api/live/stream?taskId=T-1");
  });

  it("applies mission updates without a browser reload", async () => {
    renderLive();
    const es = MockEventSource.instances[0];
    if (!es) throw new Error("expected EventSource");

    act(() => {
      es.emit("mission.updated", JSON.stringify({
        kind: "mission.updated",
        sequence: 1,
        scope: "task",
        taskId: "T-1",
        ts: "2026-05-19T00:02:00.000Z",
        id: "live-1",
        payload: {
          mission: mission({ goal: "Updated live goal" }),
          event: {
            type: "mission.updated",
            taskId: "T-1",
            patch: { goal: "Updated live goal" },
            ts: "2026-05-19T00:02:00.000Z",
          },
        },
      }));
    });

    await screen.findByText("Updated live goal");
    expect(screen.getByText("Mission updated")).toBeInTheDocument();
  });

  it("applies claim updates and renders claim transcript entries", async () => {
    renderLive();
    const es = MockEventSource.instances[0];
    if (!es) throw new Error("expected EventSource");
    const updatedClaim = claim({ status: "proven" });

    act(() => {
      es.emit("claims.updated", JSON.stringify({
        kind: "claims.updated",
        sequence: 2,
        scope: "task",
        taskId: "T-1",
        ts: "2026-05-19T00:03:00.000Z",
        id: "live-2",
        payload: {
          taskId: "T-1",
          claims: [updatedClaim],
          claimEvents: [
            {
              type: "claim.status_changed",
              claimId: updatedClaim.id,
              taskId: "T-1",
              status: "proven",
              updatedAt: "2026-05-19T00:03:00.000Z",
            },
          ],
        },
      }));
    });

    await waitFor(() => expect(screen.getAllByText("proven").length).toBeGreaterThan(0));
    expect(screen.getByText("Claim claim-1 marked proven")).toBeInTheDocument();
  });

  it("invalidates mission and task queries when a live payload is malformed", async () => {
    const client = queryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderLive(client);
    const es = MockEventSource.instances[0];
    if (!es) throw new Error("expected EventSource");

    act(() => {
      es.emit("mission.updated", "{bad json");
    });

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });
});

function renderLive(client = queryClient()): void {
  render(
    <QueryClientProvider client={client}>
      <MissionCommandLive
        taskId="T-1"
        initialTask={{ task: task(), runs: [] }}
        initialMission={{
          mission: mission(),
          claims: [claim()],
          events: [],
          claimEvents: [],
        }}
      />
    </QueryClientProvider>,
  );
}

function queryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } },
  });
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "T-1",
    title: "Mission task",
    description: "",
    status: "backlog",
    workflow: "backend-feature",
    worktreePath: null,
    branchName: "codex/mission-packet-claim-ledger",
    retryCount: 0,
    priority: "medium",
    tags: [],
    phaseModels: {},
    createdAt: new Date("2026-05-19T00:00:00.000Z"),
    updatedAt: new Date("2026-05-19T00:00:00.000Z"),
    ...overrides,
  };
}

function mission(overrides: Partial<MissionPacket> = {}): MissionPacket {
  return {
    taskId: "T-1",
    goal: "Initial goal",
    successCriteria: ["Proof exists"],
    constraints: [],
    riskLevel: "medium",
    workflowIntent: "backend-feature",
    affectedAreas: ["dashboard"],
    policyProfile: "medium",
    createdAt: "2026-05-19T00:00:00.000Z",
    updatedAt: "2026-05-19T00:00:00.000Z",
    ...overrides,
  };
}

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: "claim-1",
    taskId: "T-1",
    sourceKey: "scenario:smoke",
    text: "Scenario smoke must pass",
    owner: "planner",
    status: "pending",
    evidence: [],
    source: "plan",
    createdAt: "2026-05-19T00:00:00.000Z",
    updatedAt: "2026-05-19T00:00:00.000Z",
    ...overrides,
  };
}
