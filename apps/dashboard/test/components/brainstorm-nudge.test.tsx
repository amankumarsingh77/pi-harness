import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { BrainstormJsonlEvent } from "@/lib/api";

// Mock the server action module: a vitest-controlled fn returns void after a
// microtask so the useTransition spinner has a chance to flicker. Tests
// assert against the mock to verify wiring. vi.hoisted moves the mock fn
// definition above the hoisted vi.mock() call so the factory can capture it.
const { submitNudgeMock } = vi.hoisted(() => ({
  submitNudgeMock: vi.fn(async (..._args: unknown[]) => {}),
}));
vi.mock("@/app/tasks/[id]/actions", () => ({
  submitBrainstormNudgeAction: submitNudgeMock,
  approveBrainstormAction: vi.fn(),
  requestBrainstormChangesAction: vi.fn(),
  submitBrainstormAnswersAction: vi.fn(),
}));

// Stub the shared brainstorm events context so the ChatPanel doesn't need
// the real provider in happy-dom. Tests can override per-test via
// mockReturnValue. Also stub useEvents (still used by other components in
// the project) for safety.
const useEventsMock = vi.hoisted(() =>
  vi.fn<() => { events: unknown[]; connected?: boolean }>(() => ({ events: [] })),
);
vi.mock("@/lib/use-events", () => ({
  useEvents: useEventsMock,
}));
vi.mock("@/lib/brainstorm-events-context", () => ({
  useBrainstormEvents: useEventsMock,
  BrainstormEventsProvider: ({ children }: { children: React.ReactNode }) => children,
}));
// Stub next/navigation router.refresh.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

beforeEach(() => {
  submitNudgeMock.mockClear();
  useEventsMock.mockReturnValue({ events: [], connected: false });
  cleanup();
});

import { ChatPanel } from "@/components/brainstorm/chat-panel";
import { NudgeInput } from "@/components/brainstorm/nudge-input";

describe("NudgeInput", () => {
  it("disables send when textarea is empty", () => {
    render(<NudgeInput taskId="t1" disabled={false} />);
    const send = screen.getByRole("button", { name: /send nudge/i });
    expect(send).toBeDisabled();
  });

  it("enables send and calls action on submit", async () => {
    render(<NudgeInput taskId="t1" disabled={false} />);
    const ta = screen.getByLabelText(/nudge the agent/i);
    fireEvent.change(ta, { target: { value: "focus on backend only" } });
    const send = screen.getByRole("button", { name: /send nudge/i });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(submitNudgeMock).toHaveBeenCalledTimes(1));
    expect(submitNudgeMock).toHaveBeenCalledWith("t1", "focus on backend only");
  });

  it("disables textarea + send when disabled prop is true", () => {
    render(<NudgeInput taskId="t1" disabled={true} />);
    expect(screen.getByLabelText(/nudge the agent/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /send nudge/i })).toBeDisabled();
  });

  it("rejects whitespace-only input (keeps send disabled)", () => {
    render(<NudgeInput taskId="t1" disabled={false} />);
    const ta = screen.getByLabelText(/nudge the agent/i);
    fireEvent.change(ta, { target: { value: "    \n\n  " } });
    expect(screen.getByRole("button", { name: /send nudge/i })).toBeDisabled();
  });

  it("rejects oversize input (>4000 chars)", () => {
    render(<NudgeInput taskId="t1" disabled={false} />);
    const ta = screen.getByLabelText(/nudge the agent/i);
    fireEvent.change(ta, { target: { value: "x".repeat(4001) } });
    expect(screen.getByRole("button", { name: /send nudge/i })).toBeDisabled();
  });
});

describe("ChatPanel — nudges in transcript", () => {
  it("renders queued nudge as 'queued' and consumed nudge as 'agent saw this'", () => {
    const events: BrainstormJsonlEvent[] = [
      {
        kind: "brainstorm_user_nudge",
        ts: "2026-05-09T00:00:00.000Z",
        nudgeId: "n_one",
        comment: "ignore the auth angle, deprecated",
        consumed: false,
      },
      {
        kind: "brainstorm_user_nudge",
        ts: "2026-05-09T00:00:01.000Z",
        nudgeId: "n_two",
        comment: "focus on perf only",
        consumed: true,
      },
    ];
    render(
      <ChatPanel
        taskId="t1"
        runId="r1"
        initialEvents={events}
        gate="running"
        taskStatus="brainstorming"
      />,
    );
    const clusters = screen.getAllByTestId("nudge-cluster");
    expect(clusters).toHaveLength(2);
    const text = clusters.map((c) => c.textContent ?? "").join("\n");
    expect(text).toContain("ignore the auth angle, deprecated");
    expect(text).toContain("focus on perf only");
    expect(text).toContain("queued");
    expect(text).toContain("agent saw this");
  });

  it("collapses (consumed:false → consumed:true) replacement to one entry per nudgeId", () => {
    const events: BrainstormJsonlEvent[] = [
      {
        kind: "brainstorm_user_nudge",
        ts: "2026-05-09T00:00:00.000Z",
        nudgeId: "n_dup",
        comment: "first nudge",
        consumed: false,
      },
      {
        kind: "brainstorm_user_nudge",
        ts: "2026-05-09T00:00:01.000Z",
        nudgeId: "n_dup",
        comment: "first nudge",
        consumed: true,
      },
    ];
    render(
      <ChatPanel
        taskId="t1"
        runId="r1"
        initialEvents={events}
        gate="running"
        taskStatus="brainstorming"
      />,
    );
    const clusters = screen.getAllByTestId("nudge-cluster");
    // Should render once with the latest (consumed) status.
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.textContent).toContain("agent saw this");
    expect(clusters[0]!.textContent).not.toContain("queued");
  });

  it("disables NudgeInput when task moved past brainstorming", () => {
    render(
      <ChatPanel
        taskId="t1"
        runId="r1"
        initialEvents={[]}
        gate="running"
        taskStatus="planning"
      />,
    );
    expect(screen.getByLabelText(/nudge the agent/i)).toBeDisabled();
  });

  it("disables NudgeInput when gate is awaiting_user", () => {
    render(
      <ChatPanel
        taskId="t1"
        runId="r1"
        initialEvents={[]}
        gate="awaiting_user"
        taskStatus="brainstorming"
      />,
    );
    expect(screen.getByLabelText(/nudge the agent/i)).toBeDisabled();
  });

  it("disables NudgeInput when no run exists yet (runId null)", () => {
    render(
      <ChatPanel
        taskId="t1"
        runId={null}
        initialEvents={[]}
        gate="running"
        taskStatus="brainstorming"
      />,
    );
    expect(screen.getByLabelText(/nudge the agent/i)).toBeDisabled();
  });

  it("renders activity-line when SSE has an unmatched tool_call", () => {
    useEventsMock.mockReturnValue({
      events: [
        {
          id: "1",
          runId: "r1",
          taskId: "t1",
          ts: new Date(),
          kind: "tool_call",
          tool: "read",
          input: { path: "subagents/ours/brainstorm.md" },
        },
      ],
    });
    render(
      <ChatPanel
        taskId="t1"
        runId="r1"
        initialEvents={[]}
        gate="running"
        taskStatus="brainstorming"
      />,
    );
    const line = screen.getByTestId("activity-line");
    expect(line.textContent).toContain("read");
    expect(line.textContent).toContain("subagents/ours/brainstorm.md");
  });

  it("hides activity-line once gate is awaiting_user", () => {
    useEventsMock.mockReturnValue({
      events: [
        {
          id: "1",
          runId: "r1",
          taskId: "t1",
          ts: new Date(),
          kind: "tool_call",
          tool: "bash",
          input: { command: "ls" },
        },
      ],
    });
    render(
      <ChatPanel
        taskId="t1"
        runId="r1"
        initialEvents={[]}
        gate="awaiting_user"
        taskStatus="brainstorming"
      />,
    );
    expect(screen.queryByTestId("activity-line")).toBeNull();
  });

  it("pairs an agent reply with its originating nudge by inReplyToNudgeId", () => {
    render(
      <ChatPanel
        taskId="t1"
        runId="r1"
        initialEvents={[
          {
            kind: "brainstorm_user_nudge",
            ts: "2026-05-10T00:00:00.000Z",
            nudgeId: "n_pair",
            comment: "Is that all the questions?",
            consumed: true,
          },
          {
            kind: "brainstorm_agent_reply",
            ts: "2026-05-10T00:00:01.000Z",
            replyId: "r_xyz",
            message: "Yes — those three cover the design surface.",
            inReplyToNudgeId: "n_pair",
          },
        ]}
        gate="running"
        taskStatus="brainstorming"
      />,
    );
    const cluster = screen.getByTestId("nudge-cluster");
    expect(cluster.textContent).toContain("Is that all the questions?");
    expect(cluster.textContent).toContain("Yes — those three cover the design surface.");
  });

  it("renders standalone replies (no inReplyToNudgeId) interleaved chronologically", () => {
    render(
      <ChatPanel
        taskId="t1"
        runId="r1"
        initialEvents={[
          {
            kind: "brainstorm_agent_reply",
            ts: "2026-05-10T00:00:01.000Z",
            replyId: "r_orphan",
            message: "Status: filling in the spec now.",
          },
        ]}
        gate="running"
        taskStatus="brainstorming"
      />,
    );
    const reply = screen.getByTestId("reply-card");
    expect(reply.textContent).toContain("Status: filling in the spec now.");
  });

  it("enables NudgeInput during a healthy run", () => {
    render(
      <ChatPanel
        taskId="t1"
        runId="r1"
        initialEvents={[
          {
            kind: "brainstorm_question",
            ts: "2026-05-09T00:00:00.000Z",
            questionId: "q1",
            prompt: "?",
            options: [],
            sectionTarget: { artifact: "design", section: "Goals" },
            batchId: "b1",
          },
        ]}
        gate="running"
        taskStatus="brainstorming"
      />,
    );
    expect(screen.getByLabelText(/nudge the agent/i)).toBeEnabled();
  });
});
