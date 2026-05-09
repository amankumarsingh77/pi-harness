import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, AuthError, __resetAuthCache } from "./agent-session.js";
import { createFakeAdapter } from "./_test/fake-sdk.js";
import type { PiBridgeEvent } from "./types.js";
import type { AgentSdkEvent } from "./agent-session.js";

function assistantWithUsage(input: number, output: number, costTotal: number) {
  return {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    usage: {
      input,
      output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: input + output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: costTotal },
    },
  };
}

const baseModel = { provider: "anthropic", model: "claude-opus-4-5" };

let envDir: string;
let prevCwd: string;

beforeEach(() => {
  envDir = mkdtempSync(join(tmpdir(), "pi-bridge-env-"));
  prevCwd = process.cwd();
  process.chdir(envDir);
  writeFileSync(join(envDir, ".env.harness"), "ANTHROPIC_API_KEY=test-key\n");
  __resetAuthCache();
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(envDir, { recursive: true, force: true });
  __resetAuthCache();
});

describe("createAgentSession", () => {
  it("happy path: prompt resolves with aggregated usage; emits message_delta and turn_end", async () => {
    const adapter = createFakeAdapter();
    const events: PiBridgeEvent[] = [];
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: (e) => events.push(e) },
      adapter,
    );

    const promise = session.prompt("hi");

    adapter.emit({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hello", partial: {} },
    } as AgentSdkEvent);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(12, 7, 0.0005)],
    } as AgentSdkEvent);

    const usage = await promise;
    expect(usage).toEqual({ inputTokens: 12, outputTokens: 7, costUsd: 0.0005 });
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("message_delta");
    expect(kinds).toContain("turn_end");
    const msgDelta = events.find((e) => e.kind === "message_delta");
    expect(msgDelta && "text" in msgDelta && msgDelta.text).toBe("hello");
  });

  it("tool round-trip: emits tool_call and tool_result with structured payloads", async () => {
    const adapter = createFakeAdapter();
    const events: PiBridgeEvent[] = [];
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: (e) => events.push(e) },
      adapter,
    );
    const p = session.prompt("do it");
    adapter.emit({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "foo",
      args: { x: 1 },
    } as AgentSdkEvent);
    adapter.emit({
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "foo",
      result: { y: 2 },
      isError: false,
    } as AgentSdkEvent);
    adapter.emit({ type: "agent_end", messages: [assistantWithUsage(1, 1, 0)] } as AgentSdkEvent);
    await p;

    const call = events.find((e) => e.kind === "tool_call");
    const result = events.find((e) => e.kind === "tool_result");
    expect(call).toEqual({ kind: "tool_call", tool: "foo", input: { x: 1 } });
    expect(result).toEqual({ kind: "tool_result", tool: "foo", ok: true, output: { y: 2 } });
  });

  it("tool error: emits tool_result with ok=false and error payload", async () => {
    const adapter = createFakeAdapter();
    const events: PiBridgeEvent[] = [];
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: (e) => events.push(e) },
      adapter,
    );
    const p = session.prompt("x");
    adapter.emit({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "foo",
      args: {},
    } as AgentSdkEvent);
    adapter.emit({
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "foo",
      result: { message: "boom" },
      isError: true,
    } as AgentSdkEvent);
    adapter.emit({ type: "agent_end", messages: [assistantWithUsage(0, 0, 0)] } as AgentSdkEvent);
    await p;
    const result = events.find((e) => e.kind === "tool_result");
    expect(result).toEqual({
      kind: "tool_result",
      tool: "foo",
      ok: false,
      output: { message: "boom" },
    });
  });

  it("terminate-from-tool: agent_end after a terminating tool resolves the prompt", async () => {
    // The SDK fires agent_end after a tool batch with terminate:true. Bridge does not see
    // the terminate flag itself; it only knows the turn ended via agent_end.
    const adapter = createFakeAdapter();
    const events: PiBridgeEvent[] = [];
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: (e) => events.push(e) },
      adapter,
    );
    const p = session.prompt("stop");
    adapter.emit({ type: "turn_start" } as AgentSdkEvent);
    adapter.emit({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "submit",
      args: { questions: [] },
    } as AgentSdkEvent);
    adapter.emit({
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "submit",
      result: { ok: true },
      isError: false,
    } as AgentSdkEvent);
    adapter.emit({ type: "agent_end", messages: [assistantWithUsage(3, 4, 0.001)] } as AgentSdkEvent);
    const usage = await p;
    expect(usage.costUsd).toBe(0.001);
  });

  it("maxTurns enforced: rejects in-flight prompt and aborts the SDK session", async () => {
    const adapter = createFakeAdapter();
    const events: PiBridgeEvent[] = [];
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, maxTurns: 2, onEvent: (e) => events.push(e) },
      adapter,
    );
    const p = session.prompt("loop");
    adapter.emit({ type: "turn_start" } as AgentSdkEvent);
    adapter.emit({ type: "turn_start" } as AgentSdkEvent);
    adapter.emit({ type: "turn_start" } as AgentSdkEvent);
    await expect(p).rejects.toThrow(/maxTurns exceeded/);
    expect(adapter.state.abortCalls).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.kind === "log" || (e as { kind: string }).kind === "error")).toBe(true);
  });

  it("auth missing: throws AuthError when provider has no key", async () => {
    const adapter = createFakeAdapter();
    await expect(
      createAgentSession(
        { cwd: "/tmp", model: { provider: "openai", model: "gpt-4" }, onEvent: () => {} },
        adapter,
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("single-flight: second prompt while first is in flight throws immediately", async () => {
    const adapter = createFakeAdapter();
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: () => {} },
      adapter,
    );
    const first = session.prompt("a");
    await expect(session.prompt("b")).rejects.toThrow(/in flight/);
    adapter.emit({ type: "agent_end", messages: [assistantWithUsage(0, 0, 0)] } as AgentSdkEvent);
    await first;
  });

  it("auto_retry_start: translated to a warn log", async () => {
    const adapter = createFakeAdapter();
    const events: PiBridgeEvent[] = [];
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: (e) => events.push(e) },
      adapter,
    );
    const p = session.prompt("x");
    adapter.emit({
      type: "auto_retry_start",
      attempt: 2,
      maxAttempts: 5,
      delayMs: 1000,
      errorMessage: "overloaded",
    } as AgentSdkEvent);
    adapter.emit({ type: "agent_end", messages: [assistantWithUsage(0, 0, 0)] } as AgentSdkEvent);
    await p;
    const log = events.find((e) => e.kind === "log");
    expect(log).toBeDefined();
    expect(log && "text" in log && log.text).toContain("auto_retry");
    expect(log && "text" in log && log.text).toContain("overloaded");
  });

  it("resume: passes sessionPath through to the adapter create() call", async () => {
    const adapter = createFakeAdapter();
    await createAgentSession(
      {
        cwd: "/tmp",
        model: baseModel,
        sessionPath: "/tmp/abc/pi-session.jsonl",
        onEvent: () => {},
      },
      adapter,
    );
    expect(adapter.state.createOpts?.sessionPath).toBe("/tmp/abc/pi-session.jsonl");
  });

  it("aggregates usage across multiple assistant messages in agent_end", async () => {
    const adapter = createFakeAdapter();
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: () => {} },
      adapter,
    );
    const p = session.prompt("multi");
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(10, 5, 0.002), assistantWithUsage(3, 2, 0.0005)],
    } as AgentSdkEvent);
    const usage = await p;
    expect(usage).toEqual({ inputTokens: 13, outputTokens: 7, costUsd: 0.0025 });
  });

  it("close: disposes underlying SDK session", async () => {
    const adapter = createFakeAdapter();
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: () => {} },
      adapter,
    );
    await session.close();
    expect(adapter.state.disposeCalls).toBe(1);
  });

  it("usage scoped per prompt: a second prompt aggregates only its own agent_end", async () => {
    const adapter = createFakeAdapter();
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: () => {} },
      adapter,
    );
    const p1 = session.prompt("one");
    adapter.emit({ type: "agent_end", messages: [assistantWithUsage(10, 1, 0.001)] } as AgentSdkEvent);
    const u1 = await p1;
    expect(u1.inputTokens).toBe(10);

    const p2 = session.prompt("two");
    adapter.emit({ type: "agent_end", messages: [assistantWithUsage(4, 2, 0.0002)] } as AgentSdkEvent);
    const u2 = await p2;
    expect(u2).toEqual({ inputTokens: 4, outputTokens: 2, costUsd: 0.0002 });
  });
});

describe("auth", () => {
  it("getApiKey: reads PROVIDER_API_KEY style entries from .env.harness", async () => {
    // covered indirectly by the other tests; ensure non-anthropic provider key works too
    writeFileSync(join(envDir, ".env.harness"), "OPENAI_API_KEY=k1\nANTHROPIC_API_KEY=k2\n");
    __resetAuthCache();
    const adapter = createFakeAdapter();
    await expect(
      createAgentSession(
        { cwd: "/tmp", model: { provider: "openai", model: "gpt-4" }, onEvent: () => {} },
        adapter,
      ),
    ).resolves.toBeDefined();
  });
});
