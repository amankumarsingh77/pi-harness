import { describe, it, expect, vi } from "vitest";
import { createSession } from "../src/session.js";
import type { MockPiAdapter } from "../src/_mock.js";

function makeAdapter(): MockPiAdapter {
  return {
    createAgentSession: vi.fn(async (_opts) => ({
      prompt: vi.fn(async (_text: string) => ({
        finalText: "ok",
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0.0001,
      })),
      close: vi.fn(async () => {}),
      on: (_event: string, _cb: (...args: unknown[]) => void) => {},
    })),
  };
}

describe("createSession", () => {
  it("returns a session that can prompt and close", async () => {
    const adapter = makeAdapter();
    const events: string[] = [];
    const session = await createSession(
      { cwd: "/tmp", onEvent: (e) => events.push(e.kind) },
      adapter,
    );
    const result = await session.prompt("hello");
    expect(result.finalText).toBe("ok");
    expect(result.inputTokens).toBe(10);
    await session.close();
    expect(adapter.createAgentSession).toHaveBeenCalledOnce();
  });
});
