import { describe, it, expect, vi } from "vitest";
import { PiDispatcher } from "../src/adapters/dispatcher.js";
import type { PiSession } from "@pi-harness/pi-bridge";

function mockSessionFactory() {
  const session: PiSession = {
    prompt: vi.fn(async () => ({
      finalText: "phase result",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
    })),
    close: vi.fn(async () => {}),
  };
  return { session, createSession: vi.fn(async () => session) };
}

describe("PiDispatcher", () => {
  it("runs a phase and reports usage", async () => {
    const { createSession } = mockSessionFactory();
    const events: string[] = [];
    const eventStore = {
      append: vi.fn(async (e) => events.push(e.kind)),
    };

    const d = new PiDispatcher({
      createSession,
      eventStore,
    });

    const result = await d.runPhase({
      runId: "r1",
      taskId: "t1",
      phase: "code",
      cwd: "/tmp",
      systemPrompt: "you are coder",
      userMessage: "do the thing",
    });

    expect(result.ok).toBe(true);
    expect(result.costUsd).toBe(0.001);
    expect(result.inputTokens).toBe(100);
    expect(events).toContain("phase_started");
    expect(events).toContain("phase_ended");
  });

  it("emits phase_ended with status=failed when prompt throws", async () => {
    const failing: PiSession = {
      prompt: vi.fn(async () => {
        throw new Error("LLM exploded");
      }),
      close: vi.fn(async () => {}),
    };

    const events: { kind: string; status?: string }[] = [];
    const d = new PiDispatcher({
      createSession: async () => failing,
      eventStore: {
        append: async (e) => {
          events.push({ kind: e.kind, status: (e as { status?: string }).status });
        },
      },
    });

    const result = await d.runPhase({
      runId: "r1",
      taskId: "t1",
      phase: "code",
      cwd: "/tmp",
      systemPrompt: "x",
      userMessage: "y",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("LLM exploded");
    const ended = events.find((e) => e.kind === "phase_ended");
    expect(ended?.status).toBe("failed");
  });
});
