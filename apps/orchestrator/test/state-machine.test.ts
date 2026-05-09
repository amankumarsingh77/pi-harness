import { describe, it, expect } from "vitest";
import type { Task } from "@pi-harness/shared";
import { transition, canStart } from "../src/domain/state-machine.js";

function mkTask(status: Task["status"], overrides: Partial<Task> = {}): Task {
  return {
    id: "t-1",
    title: "test",
    description: "",
    status,
    workflow: null,
    worktreePath: null,
    branchName: null,
    retryCount: 0,
    awaitingApproval: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("transition", () => {
  it("user_start_brainstorm: backlog → brainstorming, sets workflow", () => {
    const t = mkTask("backlog");
    const r = transition(t, { type: "user_start_brainstorm", workflow: "backend-feature" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.task.status).toBe("brainstorming");
      expect(r.task.workflow).toBe("backend-feature");
    }
  });

  it("rejects user_start_brainstorm from any non-backlog status", () => {
    const t = mkTask("planning", { workflow: "backend-feature" });
    const r = transition(t, { type: "user_start_brainstorm", workflow: "backend-feature" });
    expect(r.ok).toBe(false);
  });

  it("agent_phase_succeeded: brainstorming stays in brainstorming with awaitingApproval", () => {
    const t = mkTask("brainstorming", { workflow: "backend-feature" });
    const r = transition(t, { type: "agent_phase_succeeded", phase: "brainstorm" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.task.status).toBe("brainstorming");
      expect(r.task.awaitingApproval).toBe(true);
    }
  });

  it("agent_brainstorm_ready: brainstorming → brainstorming + awaitingApproval", () => {
    const t = mkTask("brainstorming", { workflow: "backend-feature" });
    const r = transition(t, { type: "agent_brainstorm_ready" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.task.status).toBe("brainstorming");
      expect(r.task.awaitingApproval).toBe(true);
    }
  });

  it("user_approve_brainstorm: brainstorming + awaitingApproval → planning", () => {
    const t = mkTask("brainstorming", { workflow: "backend-feature", awaitingApproval: true });
    const r = transition(t, { type: "user_approve_brainstorm" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.task.status).toBe("planning");
      expect(r.task.awaitingApproval).toBe(false);
    }
  });

  it("user_approve_brainstorm rejected when not awaiting approval", () => {
    const t = mkTask("brainstorming", { workflow: "backend-feature", awaitingApproval: false });
    const r = transition(t, { type: "user_approve_brainstorm" });
    expect(r.ok).toBe(false);
  });

  it("user_request_brainstorm_changes: stays in brainstorming, clears gate", () => {
    const t = mkTask("brainstorming", { workflow: "backend-feature", awaitingApproval: true });
    const r = transition(t, { type: "user_request_brainstorm_changes", comment: "more detail" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.task.status).toBe("brainstorming");
      expect(r.task.awaitingApproval).toBe(false);
    }
  });

  it("user_request_brainstorm_changes rejected when not awaiting approval", () => {
    const t = mkTask("brainstorming", { workflow: "backend-feature", awaitingApproval: false });
    const r = transition(t, { type: "user_request_brainstorm_changes", comment: "x" });
    expect(r.ok).toBe(false);
  });

  it("agent_phase_succeeded: verify → ready_to_ship", () => {
    const t = mkTask("verifying", { workflow: "backend-feature" });
    const r = transition(t, { type: "agent_phase_succeeded", phase: "verify" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.task.status).toBe("ready_to_ship");
  });

  it("agent_phase_succeeded: pr → done", () => {
    const t = mkTask("ready_to_ship", { workflow: "backend-feature" });
    const r = transition(t, { type: "agent_phase_succeeded", phase: "pr" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.task.status).toBe("done");
  });

  it("agent_phase_failed during verify with retries left → executing + retryCount++", () => {
    const t = mkTask("verifying", { workflow: "backend-feature", retryCount: 0 });
    const r = transition(t, { type: "agent_phase_failed", phase: "verify", retryCap: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.task.status).toBe("executing");
      expect(r.task.retryCount).toBe(1);
    }
  });

  it("agent_phase_failed during verify when retryCap exhausted → verification_failed", () => {
    const t = mkTask("verifying", { workflow: "backend-feature", retryCount: 2 });
    const r = transition(t, { type: "agent_phase_failed", phase: "verify", retryCap: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.task.status).toBe("verification_failed");
  });

  it("user_cancel: any non-terminal → cancelled", () => {
    for (const s of ["backlog", "brainstorming", "planning", "executing", "verifying", "verification_failed", "ready_to_ship"] as const) {
      const t = mkTask(s, { workflow: "backend-feature" });
      const r = transition(t, { type: "user_cancel" });
      expect(r.ok, `from ${s}`).toBe(true);
      if (r.ok) expect(r.task.status).toBe("cancelled");
    }
  });

  it("user_cancel from done is rejected", () => {
    const t = mkTask("done", { workflow: "backend-feature" });
    const r = transition(t, { type: "user_cancel" });
    expect(r.ok).toBe(false);
  });
});

describe("canStart", () => {
  it("returns true when concurrency below limit", () => {
    expect(canStart({ runningCount: 1, cap: 2 })).toBe(true);
  });
  it("returns false at cap", () => {
    expect(canStart({ runningCount: 2, cap: 2 })).toBe(false);
  });
});
