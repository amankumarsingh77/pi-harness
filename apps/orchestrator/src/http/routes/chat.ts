/**
 * chat.ts — HTTP routes for the general codebase chat feature (Phase 3).
 *
 * Endpoints (all under /api/chat):
 *   POST   /api/chat/threads              — create thread
 *   GET    /api/chat/threads              — list threads
 *   GET    /api/chat/threads/:id          — get thread + messages (404 if missing)
 *   PATCH  /api/chat/threads/:id/model    — update model selection (REQ-041)
 *   POST   /api/chat/threads/:id/messages — post user message, fire turn (REQ-010, EDGE-001, EDGE-007)
 *   GET    /api/chat/threads/:id/stream   — SSE frame stream (REQ-011, REQ-014)
 *   POST   /api/chat/threads/:id/stop     — abort active turn (REQ-031, EDGE-004)
 *
 * REQ-001, REQ-010, REQ-011, REQ-014, REQ-031, REQ-032, REQ-041,
 * REQ-050, EDGE-001, EDGE-004, EDGE-007
 */

import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import type { ChatModelSelection, ChatStreamFrame } from "@pi-harness/shared";
import { DEFAULT_PHASE_MODELS } from "@pi-harness/shared";
import { NotFoundError, ValidationError } from "../../domain/errors.js";
import type { ChatSessionStore } from "../../adapters/chat-store.js";
import { runChatTurn, type CreateAgentSessionFn } from "../../agents/chat-session.js";
import type { GraphifyService } from "../../services/graphify-service.js";

// ── Zod schemas ───────────────────────────────────────────────────────────────

const ModelSelectionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  thinkingLevel: z.enum(["off", "low", "medium", "high"]).default("medium"),
});

const CreateThreadSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  model: ModelSelectionSchema.optional(),
});

const PostMessageSchema = z.object({
  text: z
    .string()
    .min(1, "text must not be blank")
    .max(100_000, "text too long")
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: "text must not be blank after trimming" }),
});

// ── Per-thread active turn registry ──────────────────────────────────────────

/**
 * Mirrors runner/cancellation.ts but scoped to chat threads.
 * Keyed by threadId → AbortController for the active turn.
 */
class ChatTurnRegistry {
  private readonly active = new Map<string, AbortController>();

  /** Register a new turn. Returns the AbortController. Aborts any prior for same thread. */
  register(threadId: string): AbortController {
    const prior = this.active.get(threadId);
    if (prior) prior.abort();
    const controller = new AbortController();
    this.active.set(threadId, controller);
    return controller;
  }

  /** Returns true if a turn is currently active for the thread. */
  isActive(threadId: string): boolean {
    return this.active.has(threadId);
  }

  /** Release after turn completes. */
  release(threadId: string, controller: AbortController): void {
    if (this.active.get(threadId) === controller) {
      this.active.delete(threadId);
    }
  }

  /** Abort and remove the active turn for the thread. Returns true if one existed. */
  abort(threadId: string): boolean {
    const controller = this.active.get(threadId);
    if (!controller) return false;
    controller.abort();
    this.active.delete(threadId);
    return true;
  }
}

// ── Default model ─────────────────────────────────────────────────────────────

type ChatThinkingLevel = ChatModelSelection["thinkingLevel"];

/** Map PhaseModelConfig.thinkingLevel → ChatThinkingLevel (which lacks "xhigh"/"minimal"). */
function toChat(level: string): ChatThinkingLevel {
  if (level === "off") return "off";
  if (level === "low" || level === "minimal") return "low";
  if (level === "medium") return "medium";
  return "high"; // "high" | "xhigh" → "high"
}

function defaultChatModel(): ChatModelSelection {
  const m = DEFAULT_PHASE_MODELS.brainstorm;
  return { provider: m.provider, model: m.model, thinkingLevel: toChat(m.thinkingLevel) };
}

// ── Small utilities ───────────────────────────────────────────────────────────

/** True when the store error message indicates the resource was not found. */
function isStoreNotFound(err: unknown): boolean {
  return err instanceof Error && err.message.includes("not found");
}

function parseCursor(value: string | string[] | undefined): number {
  if (typeof value !== "string") return 0;
  const sequence = Number.parseInt(value, 10);
  return Number.isFinite(sequence) && sequence > 0 ? sequence : 0;
}

// ── Route registration ────────────────────────────────────────────────────────

export type ChatRouteDeps = {
  readonly chatStore: ChatSessionStore;
  /**
   * cwd used for the agent session. Defaults to process.cwd().
   * Tests can override via ServerDeps.
   */
  readonly cwd?: string;
  readonly graphify?: GraphifyService;
  readonly graphifyQueryBudget?: number;
  /**
   * Injectable createAgentSession for tests. When absent, the real SDK is imported
   * lazily (only happens in production — never in tests that pass chatStore).
   */
  readonly createAgentSession?: CreateAgentSessionFn;
};

export function registerChatRoutes(app: FastifyInstance, deps: ChatRouteDeps): void {
  const { chatStore } = deps;
  const cwd = deps.cwd ?? process.cwd();
  const registry = new ChatTurnRegistry();

  // Resolve createAgentSession. Tests inject a mock; production falls back to the live SDK
  // via a lazy dynamic import so tests never trigger the real bridge import chain.
  const resolvedCreateAgentSession: CreateAgentSessionFn =
    deps.createAgentSession ??
    (async (opts) => {
      const { createAgentSession } = await import("@pi-harness/pi-bridge");
      return createAgentSession(opts);
    });

  // The provider/model catalog moved to GET /api/providers (see routes/providers.ts) —
  // it is shared by the chat picker and the new-task stage selector.

  // ── POST /api/chat/threads ───────────────────────────────────────────────────

  app.post("/api/chat/threads", async (req, _reply) => {
    let parsed: z.infer<typeof CreateThreadSchema>;
    try {
      parsed = CreateThreadSchema.parse(req.body);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new ValidationError("invalid thread body", { issues: e.issues });
      }
      throw e;
    }

    const model: ChatModelSelection = parsed.model
      ? { provider: parsed.model.provider, model: parsed.model.model, thinkingLevel: parsed.model.thinkingLevel }
      : defaultChatModel();

    return chatStore.createThread({
      ...(parsed.title !== undefined ? { title: parsed.title } : {}),
      model,
    });
  });

  // ── GET /api/chat/threads ────────────────────────────────────────────────────

  app.get("/api/chat/threads", async () => {
    const threads = await chatStore.listThreads();
    return { threads };
  });

  // ── GET /api/chat/threads/:id ────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>("/api/chat/threads/:id", async (req, reply) => {
    try {
      return await chatStore.getThread(req.params.id);
    } catch (err) {
      if (isStoreNotFound(err)) {
        reply.code(404);
        return { error: "not_found", message: `thread not found: ${req.params.id}` };
      }
      throw err;
    }
  });

  // ── PATCH /api/chat/threads/:id/model ────────────────────────────────────────

  app.patch<{ Params: { id: string } }>("/api/chat/threads/:id/model", async (req, _reply) => {
    let parsed: z.infer<typeof ModelSelectionSchema>;
    try {
      parsed = ModelSelectionSchema.parse(req.body);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new ValidationError("invalid model body", { issues: e.issues });
      }
      throw e;
    }

    try {
      return await chatStore.updateThreadModel(req.params.id, {
        provider: parsed.provider,
        model: parsed.model,
        thinkingLevel: parsed.thinkingLevel,
      });
    } catch (err) {
      if (isStoreNotFound(err)) throw new NotFoundError("thread", req.params.id);
      throw err;
    }
  });

  // ── POST /api/chat/threads/:id/messages ──────────────────────────────────────
  // REQ-010: returns immediately with userMessage + assistantMessageId
  // EDGE-001: 409 if a turn is already active
  // EDGE-007: 400 if text is empty/whitespace

  app.post<{ Params: { id: string } }>("/api/chat/threads/:id/messages", async (req, reply) => {
    const { id: threadId } = req.params;

    // EDGE-001: reject if turn already active
    if (registry.isActive(threadId)) {
      reply.code(409);
      return { error: "turn_active", message: "a turn is already active for this thread" };
    }

    // Validate body (EDGE-007)
    let parsed: z.infer<typeof PostMessageSchema>;
    try {
      parsed = PostMessageSchema.parse(req.body);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new ValidationError("invalid message body", { issues: e.issues });
      }
      throw e;
    }

    // Verify thread exists
    let thread;
    try {
      ({ thread } = await chatStore.getThread(threadId));
    } catch (err) {
      if (isStoreNotFound(err)) throw new NotFoundError("thread", threadId);
      throw err;
    }

    // Persist user message
    const userMessage = await chatStore.appendMessage(threadId, {
      role: "user",
      parts: [{ kind: "text", text: parsed.text }],
      status: "complete",
    });

    // Pre-create streaming assistant message
    const assistantMessage = await chatStore.appendMessage(threadId, {
      role: "assistant",
      parts: [],
      status: "streaming",
    });
    const assistantMessageId = assistantMessage.id;

    // Register turn — abort controller for stop endpoint
    const controller = registry.register(threadId);

    // Fire runChatTurn without awaiting — errors land as chat.error frames
    void runChatTurn({
      cwd,
      thread,
      assistantMessageId,
      promptText: parsed.text,
      store: chatStore,
      createAgentSession: resolvedCreateAgentSession,
      ...(deps.graphify !== undefined ? { graphify: deps.graphify } : {}),
      ...(deps.graphifyQueryBudget !== undefined ? { graphifyQueryBudget: deps.graphifyQueryBudget } : {}),
      sessionPath: chatStore.sessionPath(threadId),
      signal: controller.signal,
    }).finally(() => {
      registry.release(threadId, controller);
    });

    return { userMessage, assistantMessageId };
  });

  // ── GET /api/chat/threads/:id/stream ─────────────────────────────────────────
  // SSE — mirrors live.ts verbatim, swapping store calls.
  // REQ-011, REQ-014, EDGE-003

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    "/api/chat/threads/:id/stream",
    async (req, reply) => {
      const { id: threadId } = req.params;

      // Verify thread exists before opening SSE
      try {
        await chatStore.getThread(threadId);
      } catch (err) {
        if (isStoreNotFound(err)) {
          reply.code(404);
          return { error: "not_found", message: `thread not found: ${threadId}` };
        }
        throw err;
      }

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const send = (frame: ChatStreamFrame): void => {
        reply.raw.write(
          `id: ${frame.sequence}\nevent: ${frame.kind}\ndata: ${JSON.stringify(frame)}\n\n`,
        );
      };

      const afterSequence = Math.max(
        parseCursor(req.headers["last-event-id"]),
        parseCursor(req.query.after),
      );

      // Subscribe before replaying so no frames are missed between replay and subscribe
      const unsub = chatStore.subscribeFrames(threadId, send);
      reply.raw.write(": connected\n\n");

      // Replay frames the client missed
      const existing = await chatStore.listFramesAfter(threadId, afterSequence);
      for (const frame of existing) send(frame);

      const heartbeat = setInterval(() => {
        reply.raw.write(": ping\n\n");
      }, 25_000);

      req.raw.on("close", () => {
        clearInterval(heartbeat);
        unsub();
        reply.raw.end();
      });

      return new Promise<never>(() => {});
    },
  );

  // ── POST /api/chat/threads/:id/stop ──────────────────────────────────────────
  // REQ-031, EDGE-004

  app.post<{ Params: { id: string } }>("/api/chat/threads/:id/stop", async (_req, _reply) => {
    const { id: threadId } = _req.params;
    const stopped = registry.abort(threadId);
    return { stopped };
  });
}
