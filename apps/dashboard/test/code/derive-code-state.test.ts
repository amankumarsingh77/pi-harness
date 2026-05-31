import { describe, it, expect, beforeEach } from "vitest";
import { parseExecutionDag } from "@/lib/code/parse-execution-dag";
import { deriveCodeState } from "@/lib/code/derive-code-state";
import {
  CODE_DAG_BODY,
  at,
  resetEventSeq,
  nodeStarted,
  nodeEnded,
  message,
  toolCall,
  toolResult,
  usage,
} from "./fixtures";

const dag = parseExecutionDag(CODE_DAG_BODY);

beforeEach(() => resetEventSeq());

describe("deriveCodeState", () => {
  it("seeds every node as pending with zeroed metrics when there are no events", () => {
    const state = deriveCodeState(dag, []);
    expect([...state.nodesById.values()].map((n) => n.status)).toEqual([
      "pending",
      "pending",
      "pending",
    ]);
    expect(state.metrics).toMatchObject({
      doneCount: 0,
      totalCount: 3,
      commitCount: 0,
      totalCostUsd: 0,
      waveCurrent: 1,
      waveTotal: 2,
    });
    // first runnable pending node (no deps) is auto-selected
    expect(state.autoSelectedNodeId).toBe("C-1");
  });

  it("marks a node running on code_node_started with session + startedAt", () => {
    const state = deriveCodeState(dag, [nodeStarted("C-1", at(1))]);
    const node = state.nodesById.get("C-1");
    expect(node?.status).toBe("running");
    expect(node?.sessionId).toBe("C-1-sess");
    expect(node?.startedAt).toEqual(at(1));
    expect(state.autoSelectedNodeId).toBe("C-1");
  });

  it("records a succeeded node with commit, subLine, and commitCount", () => {
    const state = deriveCodeState(dag, [
      nodeStarted("C-1", at(1)),
      nodeEnded("C-1", "succeeded", at(3), { commitSha: "a1b2c3d4e5", durationMs: 2000 }),
    ]);
    const node = state.nodesById.get("C-1");
    expect(node?.status).toBe("succeeded");
    expect(node?.commitSha).toBe("a1b2c3d4e5");
    expect(node?.subLine).toBe("committed a1b2c3d");
    expect(node?.transcript.some((t) => t.kind === "commit")).toBe(true);
    expect(state.metrics.commitCount).toBe(1);
    expect(state.metrics.doneCount).toBe(1);
  });

  it("cascades blocked to transitive dependents of a failed node", () => {
    // C-5 depends on C-1 and C-2. Fail C-1 → C-5 blocked even though C-2 ok.
    const state = deriveCodeState(dag, [
      nodeStarted("C-1", at(1)),
      nodeEnded("C-1", "failed", at(2), { error: "write set insufficient" }),
      nodeStarted("C-2", at(1)),
      nodeEnded("C-2", "succeeded", at(3), { commitSha: "deadbeef" }),
    ]);
    expect(state.nodesById.get("C-1")?.status).toBe("failed");
    expect(state.nodesById.get("C-5")?.status).toBe("blocked");
    expect(state.nodesById.get("C-5")?.subLine).toContain("blocked by");
  });

  it("pairs tool_call + tool_result by callId into one resolved tool item", () => {
    const state = deriveCodeState(dag, [
      nodeStarted("C-1", at(1)),
      toolCall("C-1", "call-1", "edit", { path: "src/a.ts" }, at(2)),
      toolResult("C-1", "call-1", "edit", true, at(3), "ok"),
    ]);
    const node = state.nodesById.get("C-1");
    const toolItems = node?.transcript.filter((t) => t.kind === "tool") ?? [];
    expect(toolItems).toHaveLength(1);
    const tool = toolItems[0];
    expect(tool).toMatchObject({ callId: "call-1", status: "ok", durationMs: 1000 });
    expect(node?.toolCallCount).toBe(1);
    expect(node?.editCount).toBe(1);
  });

  it("isolates transcript events by subagent node id", () => {
    const state = deriveCodeState(dag, [
      nodeStarted("C-1", at(1)),
      nodeStarted("C-2", at(1)),
      message("C-1", "working on C-1", at(2)),
      message("C-2", "working on C-2", at(2)),
    ]);
    const c1 = state.nodesById.get("C-1");
    const c2 = state.nodesById.get("C-2");
    expect(c1?.transcript.some((t) => t.kind === "message" && t.text.includes("C-1"))).toBe(true);
    expect(c1?.transcript.some((t) => t.kind === "message" && t.text.includes("C-2"))).toBe(false);
    expect(c2?.transcript.some((t) => t.kind === "message" && t.text.includes("C-2"))).toBe(true);
  });

  it("reflects the latest message as the running node's subLine", () => {
    const state = deriveCodeState(dag, [
      nodeStarted("C-1", at(1)),
      message("C-1", "Writing the runnable-batch selector", at(2)),
    ]);
    expect(state.nodesById.get("C-1")?.subLine).toBe("Writing the runnable-batch selector");
  });

  it("coalesces consecutive streamed deltas into one flowing message", () => {
    const state = deriveCodeState(dag, [
      nodeStarted("C-1", at(1)),
      message("C-1", "I", at(2)),
      message("C-1", "'ll ", at(2)),
      message("C-1", "start ", at(2)),
      message("C-1", "reading.", at(2)),
    ]);
    const messages = state.nodesById.get("C-1")?.transcript.filter((t) => t.kind === "message") ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ kind: "message", text: "I'll start reading." });
  });

  it("starts a new message after a tool call breaks the delta run", () => {
    const state = deriveCodeState(dag, [
      nodeStarted("C-1", at(1)),
      message("C-1", "before ", at(2)),
      toolCall("C-1", "call-1", "edit", { path: "a.ts" }, at(3)),
      toolResult("C-1", "call-1", "edit", true, at(4)),
      message("C-1", "after", at(5)),
    ]);
    const messages = state.nodesById.get("C-1")?.transcript.filter((t) => t.kind === "message") ?? [];
    expect(messages.map((m) => (m.kind === "message" ? m.text : ""))).toEqual(["before ", "after"]);
  });

  it("computes wave state and current wave from real waves", () => {
    const state = deriveCodeState(dag, [
      nodeStarted("C-1", at(1)),
      nodeEnded("C-1", "succeeded", at(3), { commitSha: "aaa1111" }),
      nodeStarted("C-2", at(1)),
      nodeEnded("C-2", "succeeded", at(3), { commitSha: "bbb2222" }),
      nodeStarted("C-5", at(4)),
    ]);
    expect(state.waves.map((w) => w.state)).toEqual(["done", "running"]);
    expect(state.metrics.waveCurrent).toBe(2);
    expect(state.metrics.waveTotal).toBe(2);
  });

  it("prefers a code_usage event over summed node tokens for metrics", () => {
    const state = deriveCodeState(dag, [
      nodeStarted("C-1", at(1)),
      nodeEnded("C-1", "succeeded", at(3), { commitSha: "aaa1111", costUsd: 0.05 }),
      usage(50_000, 8_000, 0.42, at(4)),
    ]);
    expect(state.metrics.totalInputTokens).toBe(50_000);
    expect(state.metrics.totalOutputTokens).toBe(8_000);
    expect(state.metrics.totalCostUsd).toBe(0.42);
  });

  it("falls back to phase grouping when the DAG has no waves", () => {
    const noWaves = parseExecutionDag(`version: 1
nodes:
  - id: C-1
    title: A
    phase: Foundation
    safety: parallel-safe
    dependsOn: []
  - id: C-2
    title: B
    phase: Wiring
    safety: exclusive
    dependsOn: [C-1]
`);
    const state = deriveCodeState(noWaves, []);
    expect(state.waves.map((w) => w.name)).toEqual(["Foundation", "Wiring"]);
    expect(state.metrics.waveTotal).toBe(2);
  });
});
