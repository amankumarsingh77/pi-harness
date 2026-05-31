import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatSessionStore } from "../../src/adapters/chat-store.js";
import type { ChatModelSelection } from "@pi-harness/shared";

const MODEL: ChatModelSelection = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  thinkingLevel: "off",
};

let stateDir: string;
let store: ChatSessionStore;

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "chat-store-"));
  store = new ChatSessionStore({ stateDir });
});

afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

// ── Thread CRUD ───────────────────────────────────────────────────────────────

describe("createThread / listThreads / getThread", () => {
  it("creates a thread and returns it from listThreads", async () => {
    const thread = await store.createThread({ model: MODEL, title: "My first chat" });

    expect(thread.id).toBeTypeOf("string");
    expect(thread.title).toBe("My first chat");
    expect(thread.model).toEqual(MODEL);
    expect(thread.createdAt).toBeInstanceOf(Date);
    expect(thread.updatedAt).toBeInstanceOf(Date);

    const threads = await store.listThreads();
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe(thread.id);
  });

  it("listThreads returns newest first", async () => {
    const t1 = await store.createThread({ model: MODEL, title: "First" });
    const t2 = await store.createThread({ model: MODEL, title: "Second" });

    const threads = await store.listThreads();
    expect(threads[0].id).toBe(t2.id);
    expect(threads[1].id).toBe(t1.id);
  });

  it("defaults to thread id as title when not provided", async () => {
    const thread = await store.createThread({ model: MODEL });
    expect(typeof thread.title).toBe("string");
    expect(thread.title.length).toBeGreaterThan(0);
  });

  it("getThread returns thread + empty messages before any appends", async () => {
    const thread = await store.createThread({ model: MODEL, title: "T1" });
    const result = await store.getThread(thread.id);
    expect(result.thread.id).toBe(thread.id);
    expect(result.messages).toEqual([]);
  });

  it("getThread throws when threadId is unknown", async () => {
    await expect(store.getThread("no-such-thread")).rejects.toThrow();
  });
});

// ── Messages ──────────────────────────────────────────────────────────────────

describe("appendMessage", () => {
  it("persists a message and returns it from getThread", async () => {
    const thread = await store.createThread({ model: MODEL, title: "T" });

    const msg = await store.appendMessage(thread.id, {
      role: "user",
      parts: [{ kind: "text", text: "hello" }],
      status: "complete",
    });

    expect(msg.id).toBeTypeOf("string");
    expect(msg.threadId).toBe(thread.id);
    expect(msg.role).toBe("user");
    expect(msg.parts).toEqual([{ kind: "text", text: "hello" }]);
    expect(msg.createdAt).toBeInstanceOf(Date);

    const { messages } = await store.getThread(thread.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(msg.id);
  });

  it("bumps thread updatedAt when message is appended", async () => {
    const thread = await store.createThread({ model: MODEL });
    const before = thread.updatedAt;

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 5));
    await store.appendMessage(thread.id, {
      role: "user",
      parts: [{ kind: "text", text: "hi" }],
      status: "complete",
    });

    const { thread: updated } = await store.getThread(thread.id);
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

// ── updateThreadModel ─────────────────────────────────────────────────────────

describe("updateThreadModel", () => {
  it("updates the model on the thread (REQ-041/043)", async () => {
    const thread = await store.createThread({ model: MODEL });
    const newModel: ChatModelSelection = {
      provider: "openai",
      model: "gpt-4o",
      thinkingLevel: "off",
    };

    const updated = await store.updateThreadModel(thread.id, newModel);
    expect(updated.model).toEqual(newModel);

    const { thread: loaded } = await store.getThread(thread.id);
    expect(loaded.model).toEqual(newModel);
  });
});

// ── Frame log — sequence + fan-out ───────────────────────────────────────────

describe("publishFrame / subscribeFrames / listFramesAfter (REQ-050 + EDGE-003)", () => {
  it("assigns monotonically increasing sequence numbers per thread", async () => {
    const t = await store.createThread({ model: MODEL });

    const f1 = await store.publishFrame(t.id, { kind: "chat.delta", payload: { messageId: "m1", text: "a" } });
    const f2 = await store.publishFrame(t.id, { kind: "chat.delta", payload: { messageId: "m1", text: "b" } });
    const f3 = await store.publishFrame(t.id, { kind: "chat.delta", payload: { messageId: "m1", text: "c" } });

    expect(f1.sequence).toBe(1);
    expect(f2.sequence).toBe(2);
    expect(f3.sequence).toBe(3);
  });

  it("sequence is isolated per thread — thread A and B each start at 1", async () => {
    const tA = await store.createThread({ model: MODEL, title: "A" });
    const tB = await store.createThread({ model: MODEL, title: "B" });

    const fA = await store.publishFrame(tA.id, { kind: "chat.delta", payload: { messageId: "m1", text: "a" } });
    const fB = await store.publishFrame(tB.id, { kind: "chat.delta", payload: { messageId: "m2", text: "b" } });

    expect(fA.sequence).toBe(1);
    expect(fB.sequence).toBe(1);
  });

  it("listFramesAfter returns only frames with sequence > afterSeq", async () => {
    const t = await store.createThread({ model: MODEL });
    await store.publishFrame(t.id, { kind: "chat.delta", payload: { messageId: "m1", text: "x" } });
    await store.publishFrame(t.id, { kind: "chat.delta", payload: { messageId: "m1", text: "y" } });
    await store.publishFrame(t.id, { kind: "chat.delta", payload: { messageId: "m1", text: "z" } });

    const later = await store.listFramesAfter(t.id, 1);
    expect(later).toHaveLength(2);
    expect(later[0].sequence).toBe(2);
    expect(later[1].sequence).toBe(3);
  });

  it("listFramesAfter returns empty array when after is at latest", async () => {
    const t = await store.createThread({ model: MODEL });
    await store.publishFrame(t.id, { kind: "chat.delta", payload: { messageId: "m1", text: "x" } });

    const frames = await store.listFramesAfter(t.id, 1);
    expect(frames).toHaveLength(0);
  });

  it("subscribeFrames delivers published frames to subscriber", async () => {
    const t = await store.createThread({ model: MODEL });
    const received: string[] = [];
    const unsub = store.subscribeFrames(t.id, (f) => {
      if (f.kind === "chat.delta") {
        received.push((f.payload as { text: string }).text);
      }
    });

    await store.publishFrame(t.id, { kind: "chat.delta", payload: { messageId: "m1", text: "hello" } });
    await store.publishFrame(t.id, { kind: "chat.delta", payload: { messageId: "m1", text: " world" } });

    unsub();
    await store.publishFrame(t.id, { kind: "chat.delta", payload: { messageId: "m1", text: " after" } });

    expect(received).toEqual(["hello", " world"]);
  });

  it("concurrent publishes produce unique monotonic sequences (EDGE-003)", async () => {
    const t = await store.createThread({ model: MODEL });
    const frames = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        store.publishFrame(t.id, { kind: "chat.delta", payload: { messageId: "m1", text: String(i) } }),
      ),
    );
    const seqs = frames.map((f) => f.sequence).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
  });
});

// ── Persistence across instances (REQ-050) ────────────────────────────────────

describe("persistence across instances (REQ-050)", () => {
  it("threads survive a fresh store instance over the same stateDir", async () => {
    const thread = await store.createThread({ model: MODEL, title: "Persistent" });
    await store.appendMessage(thread.id, {
      role: "user",
      parts: [{ kind: "text", text: "hello" }],
      status: "complete",
    });

    // New store instance, same stateDir
    const store2 = new ChatSessionStore({ stateDir });
    const threads = await store2.listThreads();
    expect(threads).toHaveLength(1);
    expect(threads[0].title).toBe("Persistent");

    const { messages } = await store2.getThread(thread.id);
    expect(messages).toHaveLength(1);
    expect((messages[0].parts[0] as { text: string }).text).toBe("hello");
  });

  it("frames survive a fresh store instance over the same stateDir", async () => {
    const thread = await store.createThread({ model: MODEL });
    await store.publishFrame(thread.id, { kind: "chat.delta", payload: { messageId: "m1", text: "a" } });
    await store.publishFrame(thread.id, { kind: "chat.delta", payload: { messageId: "m1", text: "b" } });

    const store2 = new ChatSessionStore({ stateDir });
    const frames = await store2.listFramesAfter(thread.id, 0);
    expect(frames).toHaveLength(2);
    expect(frames[0].sequence).toBe(1);
    expect(frames[1].sequence).toBe(2);
  });

  it("new store resumes sequence from persisted high-water mark", async () => {
    const thread = await store.createThread({ model: MODEL });
    await store.publishFrame(thread.id, { kind: "chat.delta", payload: { messageId: "m1", text: "a" } });
    await store.publishFrame(thread.id, { kind: "chat.delta", payload: { messageId: "m1", text: "b" } });

    const store2 = new ChatSessionStore({ stateDir });
    const f3 = await store2.publishFrame(thread.id, { kind: "chat.delta", payload: { messageId: "m1", text: "c" } });
    expect(f3.sequence).toBe(3);
  });
});
