import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { BrainstormJsonlEvent } from "@/lib/api";

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

beforeEach(() => {
  useEventsMock.mockReturnValue({ events: [], connected: false });
  cleanup();
});

import { CostStrip } from "@/components/brainstorm/cost-strip";

describe("CostStrip", () => {
  it("renders nothing when there are no events and no run", () => {
    const { container } = render(
      <CostStrip runId={null} gate="running" initialEvents={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders zeroes for tokens and ticks when run exists but no usage events yet", () => {
    render(<CostStrip runId="r1" gate="running" initialEvents={[]} />);
    const strip = screen.getByTestId("cost-strip");
    expect(strip.textContent).toContain("0 ticks");
    expect(strip.textContent).toContain("0 in / 0 out");
    expect(strip.textContent).toContain("$0");
  });

  it("renders cumulative totals from initial events", () => {
    const events: BrainstormJsonlEvent[] = [
      {
        kind: "brainstorm_question",
        ts: "2026-05-09T15:00:00.000Z",
        questionId: "q1",
        prompt: "?",
        options: [],
        sectionTarget: { artifact: "design", section: "Goals" },
        batchId: "b1",
      },
      {
        kind: "brainstorm_usage",
        ts: "2026-05-09T15:00:30.000Z",
        tickIndex: 0,
        inputTokens: 1200,
        outputTokens: 400,
        costUsd: 0.05,
        cumulativeInputTokens: 1200,
        cumulativeOutputTokens: 400,
        cumulativeCostUsd: 0.05,
      },
      {
        kind: "brainstorm_usage",
        ts: "2026-05-09T15:01:00.000Z",
        tickIndex: 1,
        inputTokens: 800,
        outputTokens: 200,
        costUsd: 0.03,
        cumulativeInputTokens: 2000,
        cumulativeOutputTokens: 600,
        cumulativeCostUsd: 0.08,
      },
    ];
    render(<CostStrip runId="r1" gate="running" initialEvents={events} />);
    const strip = screen.getByTestId("cost-strip");
    expect(strip.textContent).toContain("2 ticks");
    expect(strip.textContent).toContain("2.0k in / 600 out");
    expect(strip.textContent).toContain("$0.08");
  });

  it("formats <$0.01 cost when cumulative is below the threshold", () => {
    const events: BrainstormJsonlEvent[] = [
      {
        kind: "brainstorm_usage",
        ts: "2026-05-09T15:00:00.000Z",
        tickIndex: 0,
        inputTokens: 5,
        outputTokens: 3,
        costUsd: 0.001,
        cumulativeInputTokens: 5,
        cumulativeOutputTokens: 3,
        cumulativeCostUsd: 0.001,
      },
    ];
    render(<CostStrip runId="r1" gate="running" initialEvents={events} />);
    const strip = screen.getByTestId("cost-strip");
    expect(strip.textContent).toContain("<$0.01");
  });

  it("uses the latest live usage event when available", () => {
    const initial: BrainstormJsonlEvent[] = [
      {
        kind: "brainstorm_usage",
        ts: "2026-05-09T15:00:00.000Z",
        tickIndex: 0,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.001,
        cumulativeInputTokens: 100,
        cumulativeOutputTokens: 50,
        cumulativeCostUsd: 0.001,
      },
    ];
    useEventsMock.mockReturnValue({
      events: [
        {
          id: "1",
          runId: "r1",
          taskId: "t1",
          ts: new Date("2026-05-09T15:00:30.000Z"),
          kind: "brainstorm_usage",
          tickIndex: 1,
          inputTokens: 200,
          outputTokens: 100,
          costUsd: 0.005,
          cumulativeInputTokens: 300,
          cumulativeOutputTokens: 150,
          cumulativeCostUsd: 0.006,
        },
      ],
    });
    render(<CostStrip runId="r1" gate="running" initialEvents={initial} />);
    const strip = screen.getByTestId("cost-strip");
    expect(strip.textContent).toContain("2 ticks");
    expect(strip.textContent).toContain("300 in / 150 out");
  });
});

