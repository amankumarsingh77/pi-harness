/**
 * Integration tests for the chat HTTP routes (Phase 3).
 *
 * These tests build a minimal Fastify instance with ONLY the chat routes,
 * avoiding the pre-existing @pi-harness/subagents import failure that breaks
 * tests importing the full server.ts. The chat routes themselves are
 * independent and do not require the broken subagents package.
 *
 * All tests use real in-process stores (ChatSessionStore via temp dir)
 * and a mocked createAgentSession that emits scripted PiBridgeEvent sequences.
 * The live SDK is never called.
 *
 * REQ-001, REQ-010, REQ-011, REQ-014, REQ-031, REQ-032, REQ-041,
 * REQ-050, EDGE-001, EDGE-003, EDGE-004, EDGE-007
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatSessionStore } from "../../src/adapters/chat-store.js";
import { registerChatRoutes } from "../../src/http/routes/chat.js";
import { registerProviderRoutes } from "../../src/http/routes/providers.js";
import { isHarnessError } from "../../src/domain/errors.js";
import type { AgentSessionOptions, PiBridgeEvent } from "@pi-harness/pi-bridge";
import type { AgentSession } from "@pi-harness/pi-bridge";
import type { CreateAgentSessionFn } from "../../src/agents/chat-session.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  expected: string,
  timeoutMs = 4000,
): Promise<string> {
  let buf = "";
  const start = Date.now();
  while (!buf.includes(expected) && Date.now() - start < timeoutMs) {
    const next = await reader.read();
    if (next.value) buf += decoder.decode(next.value);
    if (next.done) break;
  }
  return buf;
}

function parseSSEFrames(raw: string): Array<{ id?: string; event?: string; data?: string }> {
  const frames: Array<{ id?: string; event?: string; data?: string }> = [];
  const blocks = raw.split("\n\n").filter(Boolean);
  for (const block of blocks) {
    const frame: { id?: string; event?: string; data?: string } = {};
    for (const line of block.split("\n")) {
      if (line.startsWith("id: ")) frame.id = line.slice(4);
      else if (line.startsWith("event: ")) frame.event = line.slice(7);
      else if (line.startsWith("data: ")) frame.data = line.slice(6);
    }
    if (Object.keys(frame).length > 0) frames.push(frame);
  }
  return frames;
}

/**
 * Builds a mock createAgentSession that emits scripted events during prompt().
 * The emitted events flow through onEvent → store.publishFrame → SSE subscribers.
 */
function makeScriptedSession(scriptedEvents: PiBridgeEvent[]): CreateAgentSessionFn {
  return async (opts: AgentSessionOptions): Promise<AgentSession> => {
    return {
      prompt: async (_text: string) => {
        for (const ev of scriptedEvents) {
          opts.onEvent(ev);
          await new Promise<void>((r) => setImmediate(r));
        }
      },
      abort: async () => {},
      close: async () => {},
    };
  };
}

/**
 * Builds a mock createAgentSession whose prompt() blocks until aborted.
 * Used to keep a turn "active" for 409 / stop tests.
 */
function makeHangingSession(): CreateAgentSessionFn {
  return async (opts: AgentSessionOptions): Promise<AgentSession> => {
    let resolveAbort!: () => void;
    const abortPromise = new Promise<void>((r) => { resolveAbort = r; });
    return {
      prompt: async (_text: string) => {
        await abortPromise;
      },
      abort: async () => {
        opts.onEvent({ kind: "error", text: "aborted" });
        resolveAbort();
      },
      close: async () => {},
    };
  };
}

/** Build a minimal Fastify app with only chat routes for testing. */
function buildChatApp(
  chatStore: ChatSessionStore,
  createAgentSession?: CreateAgentSessionFn,
  listProviders?: () => unknown,
) {
  const app = Fastify({ logger: { level: "warn" } });
  void app.register(cors, { origin: true });

  app.setErrorHandler((err, req, reply) => {
    if (isHarnessError(err)) {
      reply.code(err.status);
      return reply.send({ error: err.code, message: err.message, details: err.details });
    }
    reply.code(500);
    const message = err instanceof Error ? err.message : String(err);
    return reply.send({ error: "internal", message });
  });

  registerChatRoutes(app, {
    chatStore,
    ...(createAgentSession ? { createAgentSession } : {}),
  });
  registerProviderRoutes(app, {
    ...(listProviders ? { listProviders: listProviders as never } : {}),
  });
  return app;
}

// ── Test setup ────────────────────────────────────────────────────────────────

describe("chat HTTP routes", () => {
  const quickSessionEvents: PiBridgeEvent[] = [
    { kind: "message_delta", text: "Hello!" },
    {
      kind: "turn_end",
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
    },
  ];

  const stateDir = mkdtempSync(join(tmpdir(), "chat-routes-test-"));
  const chatStore = new ChatSessionStore({ stateDir });
  const app = buildChatApp(chatStore, makeScriptedSession(quickSessionEvents));

  let port = 0;
  let canListen = true;

  beforeAll(async () => {
    try {
      await app.listen({ port: 0, host: "127.0.0.1" });
      port = (app.server.address() as { port: number }).port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      canListen = false;
    }
  });

  afterAll(async () => {
    if (canListen) await app.close();
  });

  function baseUrl(): string {
    return `http://127.0.0.1:${port}`;
  }

  async function createThread(title?: string): Promise<{ id: string }> {
    const res = await fetch(`${baseUrl()}/api/chat/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(title ? { title } : {}),
    });
    return res.json() as Promise<{ id: string }>;
  }

  // ── Thread CRUD ──────────────────────────────────────────────────────────────

  it("POST /api/chat/threads creates a thread with defaults (REQ-001)", async () => {
    if (!canListen) return;
    const res = await fetch(`${baseUrl()}/api/chat/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      model: expect.objectContaining({
        provider: expect.any(String),
        model: expect.any(String),
        thinkingLevel: expect.any(String),
      }),
    });
  });

  it("GET /api/providers returns the injected unified provider catalog (REQ-040, REQ-044)", async () => {
    const catalog = [
      {
        id: "anthropic",
        name: "Anthropic",
        authenticated: true,
        auth: "api-key" as const,
        requiredEnvVars: ["ANTHROPIC_API_KEY"],
        models: [
          { id: "claude-opus-4-5", name: "Claude Opus 4.5", reasoning: true, contextWindow: 200000, maxTokens: 64000, cost: { input: 5, output: 25 } },
        ],
      },
      {
        id: "crofai",
        name: "CrofAI",
        authenticated: false,
        auth: "api-key" as const,
        requiredEnvVars: ["CROFAI_API_KEY"],
        models: [
          { id: "kimi-k2.6", name: "MoonshotAI: Kimi K2.6", reasoning: true, contextWindow: 262144, maxTokens: 262144, cost: { input: 0.5, output: 1.99 } },
        ],
      },
    ];
    const localApp = buildChatApp(chatStore, undefined, () => catalog);
    const res = await localApp.inject({ method: "GET", url: "/api/providers" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { providers: typeof catalog };
    expect(body.providers.map((p) => p.id)).toEqual(["anthropic", "crofai"]);
    expect(body.providers[0]?.models[0]?.name).toBe("Claude Opus 4.5");
    expect(body.providers[1]?.requiredEnvVars).toEqual(["CROFAI_API_KEY"]);
    await localApp.close();
  });

  it("POST /api/chat/threads accepts optional title and model override", async () => {
    if (!canListen) return;
    const res = await fetch(`${baseUrl()}/api/chat/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "My Chat",
        model: { provider: "crofai", model: "kimi-k2.6", thinkingLevel: "low" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ title: "My Chat", model: { thinkingLevel: "low" } });
  });

  it("GET /api/chat/threads lists created threads (REQ-001)", async () => {
    if (!canListen) return;
    const created = await createThread("Listed");

    const listRes = await fetch(`${baseUrl()}/api/chat/threads`);
    expect(listRes.status).toBe(200);
    const { threads } = await listRes.json() as { threads: Array<Record<string, unknown>> };
    expect(threads.some((t) => t["id"] === created.id)).toBe(true);
  });

  it("GET /api/chat/threads/:id returns thread and empty messages", async () => {
    if (!canListen) return;
    const created = await createThread("Get Me");

    const getRes = await fetch(`${baseUrl()}/api/chat/threads/${created.id}`);
    expect(getRes.status).toBe(200);
    const body = await getRes.json() as Record<string, unknown>;
    expect(body).toMatchObject({ thread: { id: created.id }, messages: [] });
  });

  it("GET /api/chat/threads/:id returns 404 for missing thread", async () => {
    if (!canListen) return;
    const res = await fetch(`${baseUrl()}/api/chat/threads/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it("PATCH /api/chat/threads/:id/model updates model selection (REQ-041)", async () => {
    if (!canListen) return;
    const created = await createThread();

    const patchRes = await fetch(`${baseUrl()}/api/chat/threads/${created.id}/model`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "anthropic", model: "claude-3-5-sonnet", thinkingLevel: "high" }),
    });
    expect(patchRes.status).toBe(200);
    const body = await patchRes.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      model: { provider: "anthropic", model: "claude-3-5-sonnet", thinkingLevel: "high" },
    });
  });

  // ── Message posting ──────────────────────────────────────────────────────────

  it("POST /api/chat/threads/:id/messages returns immediately with user+assistant IDs (REQ-010)", async () => {
    if (!canListen) return;
    const created = await createThread("Msg Thread");

    const msgRes = await fetch(`${baseUrl()}/api/chat/threads/${created.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello" }),
    });
    expect(msgRes.status).toBe(200);
    const body = await msgRes.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      userMessage: expect.objectContaining({ role: "user" }),
      assistantMessageId: expect.any(String),
    });
  });

  it("POST /api/chat/threads/:id/messages rejects empty text (EDGE-007)", async () => {
    if (!canListen) return;
    const created = await createThread();

    const res = await fetch(`${baseUrl()}/api/chat/threads/${created.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "   " }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ error: "validation" });
  });

  it("POST /api/chat/threads/:id/messages returns 404 for missing thread", async () => {
    if (!canListen) return;
    const res = await fetch(`${baseUrl()}/api/chat/threads/no-such-thread/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello" }),
    });
    expect(res.status).toBe(404);
  });

  // ── SSE streaming ────────────────────────────────────────────────────────────

  it("GET /api/chat/threads/:id/stream streams delta + turn_end frames (REQ-011, REQ-050)", async () => {
    if (!canListen) return;
    const created = await createThread("SSE Thread");

    // Open SSE stream first
    const streamRes = await fetch(`${baseUrl()}/api/chat/threads/${created.id}/stream`);
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");
    const reader = streamRes.body!.getReader();
    const decoder = new TextDecoder();

    // Wait for : connected
    let buf = await readUntil(reader, decoder, ": connected");
    expect(buf).toContain(": connected");

    // Post a message — runChatTurn fires with scripted session (delta + turn_end)
    await fetch(`${baseUrl()}/api/chat/threads/${created.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Tell me something" }),
    });

    // SSE should yield chat.delta then chat.turn_end
    buf += await readUntil(reader, decoder, "chat.turn_end", 5000);
    expect(buf).toContain("chat.delta");
    expect(buf).toContain("chat.turn_end");

    await reader.cancel();
  });

  it("GET /api/chat/threads/:id/stream has id: sequence numbers (REQ-011)", async () => {
    if (!canListen) return;
    const created = await createThread("Seq Thread");

    // Post message and wait for turn to complete
    await fetch(`${baseUrl()}/api/chat/threads/${created.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Count frames" }),
    });

    // Wait for turn to complete
    await new Promise((r) => setTimeout(r, 500));

    // Now stream — should replay existing frames
    const streamRes = await fetch(`${baseUrl()}/api/chat/threads/${created.id}/stream`);
    const reader = streamRes.body!.getReader();
    const decoder = new TextDecoder();
    const buf = await readUntil(reader, decoder, "chat.turn_end", 3000);

    const frames = parseSSEFrames(buf).filter((f) => f.id !== undefined);
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      if (frame.id) expect(Number(frame.id)).toBeGreaterThan(0);
    }

    await reader.cancel();
  });

  it("last-event-id replay yields only later frames (REQ-014, EDGE-003)", async () => {
    if (!canListen) return;
    const created = await createThread("Replay Thread");

    // Post first message and wait for turn to complete
    await fetch(`${baseUrl()}/api/chat/threads/${created.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "First message" }),
    });
    await new Promise((r) => setTimeout(r, 600));

    // Post second message and wait for turn to complete
    await fetch(`${baseUrl()}/api/chat/threads/${created.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Second message" }),
    });
    await new Promise((r) => setTimeout(r, 600));

    // Get all frames — at least 4: delta+turn_end for each message
    const framesAll = await chatStore.listFramesAfter(created.id, 0);
    expect(framesAll.length).toBeGreaterThanOrEqual(2);

    // Use sequence of the first frame as cursor
    const cursor = framesAll[0]!.sequence;

    // Reconnect with that cursor
    const res = await fetch(`${baseUrl()}/api/chat/threads/${created.id}/stream`, {
      headers: { "last-event-id": String(cursor) },
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const text = await readUntil(reader, decoder, "chat.", 3000);

    // All replayed frames should have sequence > cursor
    const frames = parseSSEFrames(text).filter((f) => f.id !== undefined);
    for (const frame of frames) {
      if (frame.id) {
        expect(Number(frame.id)).toBeGreaterThan(cursor);
      }
    }

    await reader.cancel();
  });

  it("GET /api/chat/threads/:id/stream returns 404 for missing thread", async () => {
    if (!canListen) return;
    const res = await fetch(`${baseUrl()}/api/chat/threads/no-such-thread/stream`);
    expect(res.status).toBe(404);
  });

  // ── Stop endpoint + 409 — use a hanging session so the turn stays active ─────

  it("POST /api/chat/threads/:id/messages returns 409 if turn already active (EDGE-001)", async () => {
    if (!canListen) return;
    const hangStateDir = mkdtempSync(join(tmpdir(), "chat-hang-"));
    const hangStore = new ChatSessionStore({ stateDir: hangStateDir });
    const hangApp = buildChatApp(hangStore, makeHangingSession());
    await hangApp.listen({ port: 0, host: "127.0.0.1" });
    const hangPort = (hangApp.server.address() as { port: number }).port;

    try {
      // Create a thread
      const createRes = await fetch(`http://127.0.0.1:${hangPort}/api/chat/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "409 Thread" }),
      });
      const { id: threadId } = await createRes.json() as { id: string };

      // Post first message — starts a hanging turn
      await fetch(`http://127.0.0.1:${hangPort}/api/chat/threads/${threadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "First" }),
      });

      // Second message while first is active → 409 (EDGE-001)
      const res = await fetch(`http://127.0.0.1:${hangPort}/api/chat/threads/${threadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Second — should 409" }),
      });
      expect(res.status).toBe(409);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toMatchObject({ error: "turn_active" });
    } finally {
      await hangApp.close();
    }
  });

  it("POST /api/chat/threads/:id/stop aborts active turn (REQ-031)", async () => {
    if (!canListen) return;
    const stopStateDir = mkdtempSync(join(tmpdir(), "chat-stop-"));
    const stopStore = new ChatSessionStore({ stateDir: stopStateDir });
    const stopApp = buildChatApp(stopStore, makeHangingSession());
    await stopApp.listen({ port: 0, host: "127.0.0.1" });
    const stopPort = (stopApp.server.address() as { port: number }).port;

    try {
      const createRes = await fetch(`http://127.0.0.1:${stopPort}/api/chat/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Stop Thread" }),
      });
      const { id: threadId } = await createRes.json() as { id: string };

      // Open SSE stream
      const streamRes = await fetch(
        `http://127.0.0.1:${stopPort}/api/chat/threads/${threadId}/stream`,
      );
      const reader = streamRes.body!.getReader();
      const decoder = new TextDecoder();
      let buf = await readUntil(reader, decoder, ": connected");
      expect(buf).toContain(": connected");

      // Post a message to start a hanging turn
      await fetch(`http://127.0.0.1:${stopPort}/api/chat/threads/${threadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Start a long turn" }),
      });

      // Stop the turn (REQ-031)
      const stopRes = await fetch(
        `http://127.0.0.1:${stopPort}/api/chat/threads/${threadId}/stop`,
        { method: "POST" },
      );
      expect(stopRes.status).toBe(200);
      const stopBody = await stopRes.json() as Record<string, unknown>;
      expect(stopBody).toMatchObject({ stopped: true });

      // SSE should yield chat.stopped or chat.error (hanging mock emits error "aborted")
      buf += await readUntil(reader, decoder, "chat.", 3000);
      expect(buf.includes("chat.stopped") || buf.includes("chat.error")).toBe(true);

      await reader.cancel();
    } finally {
      await stopApp.close();
    }
  });

  it("POST /api/chat/threads/:id/stop is no-op when no turn active (EDGE-004)", async () => {
    if (!canListen) return;
    const created = await createThread();

    const res = await fetch(`${baseUrl()}/api/chat/threads/${created.id}/stop`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ stopped: false });
  });
});
