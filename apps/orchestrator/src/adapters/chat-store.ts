import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  ChatMessage,
  ChatMessagePart,
  ChatModelSelection,
  ChatStreamFrame,
  ChatStreamKind,
  ChatStreamPayloadByKind,
} from "@pi-harness/shared";
import type { ChatThread } from "@pi-harness/shared";
import { appendJsonl, readJsonl } from "./jsonl-writer.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ChatSessionStoreOpts = {
  readonly stateDir: string;
};

type CreateThreadInput = {
  readonly title?: string;
  readonly model: ChatModelSelection;
  readonly branch?: string;
};

type AppendMessageInput = {
  /** When provided, the record is treated as an update of an existing message (last-write-wins via dedup). */
  readonly id?: string;
  readonly role: "user" | "assistant";
  readonly parts: readonly ChatMessagePart[];
  readonly status: ChatMessage["status"];
  readonly usage?: ChatMessage["usage"];
  readonly error?: string;
};

type PublishFrameInput<K extends ChatStreamKind = ChatStreamKind> = {
  readonly kind: K;
  readonly payload: ChatStreamPayloadByKind[K];
};

type FrameSubscriber = (frame: ChatStreamFrame) => void;

// ── Serialization helpers ─────────────────────────────────────────────────────

type SerializedThread = Omit<ChatThread, "createdAt" | "updatedAt"> & {
  readonly createdAt: string;
  readonly updatedAt: string;
};

type SerializedMessage = Omit<ChatMessage, "createdAt"> & {
  readonly createdAt: string;
};

type SerializedFrame = Omit<ChatStreamFrame, "ts"> & {
  readonly ts: string;
};

function serializeThread(t: ChatThread): SerializedThread {
  return { ...t, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() };
}

function parseThread(v: unknown): ChatThread | null {
  if (!isRecord(v)) return null;
  const createdAt = parseDate(v["createdAt"]);
  const updatedAt = parseDate(v["updatedAt"]);
  if (
    !createdAt ||
    !updatedAt ||
    typeof v["id"] !== "string" ||
    typeof v["title"] !== "string" ||
    !isRecord(v["model"])
  )
    return null;
  return {
    id: v["id"],
    title: v["title"],
    createdAt,
    updatedAt,
    model: v["model"] as ChatModelSelection,
    ...(typeof v["branch"] === "string" ? { branch: v["branch"] } : {}),
  };
}

function serializeMessage(m: ChatMessage): SerializedMessage {
  return { ...m, createdAt: m.createdAt.toISOString() };
}

function parseMessage(v: unknown): ChatMessage | null {
  if (!isRecord(v)) return null;
  const createdAt = parseDate(v["createdAt"]);
  if (
    !createdAt ||
    typeof v["id"] !== "string" ||
    typeof v["threadId"] !== "string" ||
    !Array.isArray(v["parts"])
  )
    return null;
  const msg: ChatMessage = {
    id: v["id"],
    threadId: v["threadId"],
    role: (v["role"] as ChatMessage["role"]) ?? "user",
    createdAt,
    parts: v["parts"] as readonly ChatMessagePart[],
    status: (v["status"] as ChatMessage["status"]) ?? "complete",
  };
  if (isRecord(v["usage"])) {
    return { ...msg, usage: v["usage"] as NonNullable<ChatMessage["usage"]> };
  }
  if (typeof v["error"] === "string") {
    return { ...msg, error: v["error"] };
  }
  return msg;
}

function serializeFrame(f: ChatStreamFrame): SerializedFrame {
  return { ...f, ts: f.ts.toISOString() };
}

function parseFrame(v: unknown): ChatStreamFrame | null {
  if (!isRecord(v)) return null;
  const ts = parseDate(v["ts"]);
  if (
    !ts ||
    typeof v["id"] !== "string" ||
    typeof v["sequence"] !== "number" ||
    typeof v["threadId"] !== "string" ||
    typeof v["kind"] !== "string" ||
    !("payload" in v)
  )
    return null;
  return {
    id: v["id"],
    sequence: v["sequence"],
    ts,
    threadId: v["threadId"],
    kind: v["kind"] as ChatStreamKind,
    payload: v["payload"] as ChatStreamPayloadByKind[ChatStreamKind],
  };
}

// ── ChatSessionStore ──────────────────────────────────────────────────────────

export class ChatSessionStore {
  private readonly stateDir: string;
  // Per-thread subscribers
  private readonly frameSubs = new Map<string, Set<FrameSubscriber>>();
  // Per-thread serialized promise chain for monotonic sequence (mirrors LiveEventStore.sequenceChain)
  private readonly sequenceChains = new Map<string, Promise<void>>();

  constructor(opts: ChatSessionStoreOpts) {
    this.stateDir = opts.stateDir;
  }

  // ── Thread paths ───────────────────────────────────────────────────────────

  private threadsPath(): string {
    return join(this.stateDir, "store", "chat", "threads.jsonl");
  }

  private messagesPath(threadId: string): string {
    return join(this.stateDir, "store", "chat", threadId, "messages.jsonl");
  }

  private framesPath(threadId: string): string {
    return join(this.stateDir, "store", "chat", threadId, "frames.jsonl");
  }

  /**
   * Stable per-thread pi-session file. Passed to the turn driver so the SDK
   * persists conversation state across turns (multi-turn context).
   */
  sessionPath(threadId: string): string {
    return join(this.stateDir, "store", "chat", threadId, "session.json");
  }

  // ── Thread CRUD ────────────────────────────────────────────────────────────

  async createThread(input: CreateThreadInput): Promise<ChatThread> {
    const id = randomUUID();
    const now = new Date();
    const thread: ChatThread = {
      id,
      title: input.title ?? id,
      createdAt: now,
      updatedAt: now,
      model: input.model,
      ...(input.branch !== undefined ? { branch: input.branch } : {}),
    };
    await appendJsonl(this.threadsPath(), serializeThread(thread));
    return thread;
  }

  async listThreads(): Promise<ChatThread[]> {
    const raw = await readJsonl<unknown>(this.threadsPath());
    const threads = raw.map(parseThread).filter((t): t is ChatThread => t !== null);
    // Deduplicate: last write wins (updateThreadModel re-appends). Track insertion index for tiebreak.
    const byId = new Map<string, { thread: ChatThread; insertionIndex: number }>();
    for (let i = 0; i < threads.length; i++) {
      const t = threads[i];
      if (t) byId.set(t.id, { thread: t, insertionIndex: i });
    }
    return [...byId.values()]
      .sort((a, b) => {
        const timeDiff = b.thread.createdAt.getTime() - a.thread.createdAt.getTime();
        if (timeDiff !== 0) return timeDiff;
        return b.insertionIndex - a.insertionIndex;
      })
      .map((v) => v.thread);
  }

  async getThread(id: string): Promise<{ thread: ChatThread; messages: ChatMessage[] }> {
    const threads = await this.listThreads();
    const thread = threads.find((t) => t.id === id);
    if (!thread) throw new Error(`ChatSessionStore: thread ${id} not found`);

    const raw = await readJsonl<unknown>(this.messagesPath(id));
    const allMessages = raw.map(parseMessage).filter((m): m is ChatMessage => m !== null);
    // Deduplicate by id: last write wins (finalized messages overwrite streaming records)
    const byId = new Map<string, ChatMessage>();
    for (const m of allMessages) byId.set(m.id, m);
    const messages = [...byId.values()];

    return { thread, messages };
  }

  async appendMessage(threadId: string, input: AppendMessageInput): Promise<ChatMessage> {
    // Verify thread exists
    const threads = await this.listThreads();
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) throw new Error(`ChatSessionStore: thread ${threadId} not found`);

    const now = new Date();
    const msg: ChatMessage = {
      id: input.id ?? randomUUID(),
      threadId,
      role: input.role,
      createdAt: now,
      parts: input.parts,
      status: input.status,
      ...(input.usage !== undefined ? { usage: input.usage } : {}),
      ...(input.error !== undefined ? { error: input.error } : {}),
    };
    await appendJsonl(this.messagesPath(threadId), serializeMessage(msg));

    // Bump thread updatedAt by re-appending a new record (last write wins on listThreads)
    const updated: ChatThread = { ...thread, updatedAt: now };
    await appendJsonl(this.threadsPath(), serializeThread(updated));

    return msg;
  }

  async updateThreadModel(threadId: string, model: ChatModelSelection): Promise<ChatThread> {
    const threads = await this.listThreads();
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) throw new Error(`ChatSessionStore: thread ${threadId} not found`);

    const updated: ChatThread = { ...thread, model, updatedAt: new Date() };
    await appendJsonl(this.threadsPath(), serializeThread(updated));
    return updated;
  }

  // ── Frame log ──────────────────────────────────────────────────────────────

  publishFrame<K extends ChatStreamKind>(
    threadId: string,
    input: PublishFrameInput<K>,
  ): Promise<ChatStreamFrame<K>> {
    return this.runSequential(threadId, async () => {
      const frames = await this.listFramesAll(threadId);
      const sequence = (frames.length > 0 ? Math.max(...frames.map((f) => f.sequence)) : 0) + 1;
      const frame: ChatStreamFrame<K> = {
        id: randomUUID(),
        sequence,
        ts: new Date(),
        threadId,
        kind: input.kind,
        payload: input.payload,
      };
      await appendJsonl(this.framesPath(threadId), serializeFrame(frame));
      this.emitFrame(threadId, frame as ChatStreamFrame);
      return frame;
    });
  }

  subscribeFrames(threadId: string, cb: FrameSubscriber): () => void {
    const existing = this.frameSubs.get(threadId);
    const subs = existing ?? new Set<FrameSubscriber>();
    if (!existing) this.frameSubs.set(threadId, subs);
    subs.add(cb);
    return () => subs.delete(cb);
  }

  async listFramesAfter(threadId: string, afterSeq: number): Promise<ChatStreamFrame[]> {
    const all = await this.listFramesAll(threadId);
    return all.filter((f) => f.sequence > afterSeq).sort((a, b) => a.sequence - b.sequence);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async listFramesAll(threadId: string): Promise<ChatStreamFrame[]> {
    const raw = await readJsonl<unknown>(this.framesPath(threadId));
    return raw.map(parseFrame).filter((f): f is ChatStreamFrame => f !== null);
  }

  private runSequential<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
    const chain = this.sequenceChains.get(threadId) ?? Promise.resolve();
    const run = chain.then(fn, fn);
    this.sequenceChains.set(
      threadId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private emitFrame(threadId: string, frame: ChatStreamFrame): void {
    const subs = this.frameSubs.get(threadId);
    if (!subs) return;
    for (const sub of subs) sub(frame);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
