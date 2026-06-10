import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentSessionOptions } from "@pi-harness/pi-bridge";
import {
  createPhaseSessionFactory,
  phaseSessionPath,
} from "../src/runner/phase-session-manager.js";

describe("phase session manager", () => {
  it("owns stable session paths for main phases and child scopes", () => {
    const cwd = "/tmp/worktree";
    const base = { cwd, taskId: "T-1" };

    expect(phaseSessionPath({ ...base, phase: "brainstorm", scope: { kind: "main" } }))
      .toBe("/tmp/worktree/.harness/T-1/pi-session.jsonl");
    expect(phaseSessionPath({
      ...base,
      phase: "brainstorm",
      scope: { kind: "brainstorm-research", subagent: "web search/researcher" },
    })).toBe("/tmp/worktree/.harness/T-1/brainstorm-sessions/web-search-researcher.jsonl");
    expect(phaseSessionPath({ ...base, phase: "plan", scope: { kind: "main" } }))
      .toBe("/tmp/worktree/.harness/T-1/pi-session-plan.jsonl");
    expect(phaseSessionPath({ ...base, phase: "code", scope: { kind: "code-node", nodeId: "C 001" } }))
      .toBe("/tmp/worktree/.harness/T-1/code-sessions/C-001.jsonl");
    expect(phaseSessionPath({ ...base, phase: "verify", scope: { kind: "main" } }))
      .toBe("/tmp/worktree/.harness/T-1/pi-session-verify.jsonl");
    expect(phaseSessionPath({ ...base, phase: "pr", scope: { kind: "main" } }))
      .toBe("/tmp/worktree/.harness/T-1/pi-session-pr.jsonl");
  });

  it("opens managed sessions with the computed path and resets corrupted files once", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "session-manager-test-"));
    const sessionPath = phaseSessionPath({
      cwd,
      taskId: "T-1",
      phase: "verify",
      scope: { kind: "main" },
    });
    await mkdir(dirname(sessionPath), { recursive: true });
    await writeFile(sessionPath, "{broken\n", "utf8");

    const resets: string[] = [];
    const createAgentSession = vi
      .fn<(opts: AgentSessionOptions) => Promise<{
        readonly prompt: () => Promise<{ readonly inputTokens: number; readonly outputTokens: number; readonly costUsd: number }>;
        readonly abort: () => Promise<void>;
        readonly close: () => Promise<void>;
      }>>()
      .mockImplementationOnce(async () => {
        throw new Error("SessionManager.open: invalid jsonl");
      })
      .mockImplementationOnce(async () => ({
        async prompt() {
          return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
        },
        async abort() {},
        async close() {},
      }));
    const factory = createPhaseSessionFactory({
      cwd,
      taskId: "T-1",
      phase: "verify",
      createAgentSession,
      onSessionReset: async (event) => {
        resets.push(`${event.phase}:${event.scope.kind}:${event.path}`);
      },
    });

    await factory.open({ kind: "main" }, {
      cwd,
      model: { provider: "test", model: "test-model" },
      onEvent: () => {},
    });

    expect(createAgentSession).toHaveBeenCalledTimes(2);
    expect(createAgentSession.mock.calls[0]?.[0].sessionPath).toBe(sessionPath);
    expect(createAgentSession.mock.calls[1]?.[0].sessionPath).toBeUndefined();
    expect(resets).toEqual([`verify:main:${sessionPath}`]);
  });
});
