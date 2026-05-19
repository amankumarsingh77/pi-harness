import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MissionCommandShell } from "@/components/mission/mission-command-shell";
import type { Claim, ClaimEvent, MissionPacket, Run, Task } from "@pi-harness/shared";

describe("MissionCommandShell", () => {
  it("renders the empty mission command state", () => {
    render(
      <MissionCommandShell
        task={task()}
        mission={mission()}
        claims={[]}
        missionEvents={[]}
        claimEvents={[]}
        runs={[]}
        onRunVerifier={() => {}}
        verifierPending={false}
      />,
    );

    expect(screen.getByText("Mission Packet")).toBeInTheDocument();
    expect(screen.getByText("Ship durable mission state")).toBeInTheDocument();
    expect(screen.getByText("No claims yet")).toBeInTheDocument();
    expect(screen.getByText("No mission transcript events")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run verifier" })).toBeInTheDocument();
  });

  it("renders challenged claims with verifier notes and evidence", () => {
    render(
      <MissionCommandShell
        task={task({ status: "planning" })}
        mission={mission({ riskLevel: "high" })}
        claims={[
          claim({
            status: "challenged",
            verifierNote: "Needs failing-path proof",
            evidence: [{ kind: "scenario", ref: "smoke", note: "red path" }],
          }),
        ]}
        missionEvents={[
          {
            type: "mission.updated",
            taskId: "T-1",
            patch: { riskLevel: "high" },
            ts: "2026-05-19T00:03:00.000Z",
          },
        ]}
        claimEvents={[claimCreatedEvent()]}
        runs={[run({ phase: "plan", status: "running" })]}
        onRunVerifier={() => {}}
        verifierPending={false}
        verifierError="verifier unavailable"
      />,
    );

    expect(screen.getAllByText("challenged").length).toBeGreaterThan(0);
    expect(screen.getByText("Needs failing-path proof")).toBeInTheDocument();
    expect(screen.getAllByText("scenario:smoke").length).toBeGreaterThan(0);
    expect(screen.getByText("Mission updated")).toBeInTheDocument();
    expect(screen.getByText("Claim seeded from scenario:smoke")).toBeInTheDocument();
    expect(screen.getByText("plan running")).toBeInTheDocument();
    expect(screen.getByText("verifier unavailable")).toBeInTheDocument();
  });
});

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
    goal: "Ship durable mission state",
    successCriteria: ["Mission packet loads", "Claims fold"],
    constraints: [],
    riskLevel: "medium",
    workflowIntent: "backend-feature",
    affectedAreas: ["orchestrator", "dashboard"],
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

type ClaimCreatedEvent = Extract<ClaimEvent, { readonly type: "claim.created" }>;

function claimCreatedEvent(overrides: Partial<ClaimCreatedEvent> = {}): ClaimEvent {
  return {
    type: "claim.created",
    claimId: "claim-1",
    taskId: "T-1",
    sourceKey: "scenario:smoke",
    text: "Scenario smoke must pass",
    owner: "planner",
    source: "plan",
    createdAt: "2026-05-19T00:02:00.000Z",
    ...overrides,
  };
}

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    taskId: "T-1",
    phase: "plan",
    status: "running",
    startedAt: new Date("2026-05-19T00:01:00.000Z"),
    endedAt: null,
    error: null,
    costUsd: 0.012,
    inputTokens: 100,
    outputTokens: 50,
    piSessionPath: null,
    ...overrides,
  };
}
