import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityLine, deriveActivity } from "@/components/brainstorm/activity-line";

describe("deriveActivity", () => {
  const now = new Date("2026-05-09T15:00:00Z").getTime();

  it("returns null when there are no tool_call events", () => {
    expect(deriveActivity([], now)).toBeNull();
    expect(
      deriveActivity([{ kind: "log", ts: new Date(now) }], now),
    ).toBeNull();
  });

  it("returns running with summarized arg for an active read tool_call", () => {
    const r = deriveActivity(
      [
        {
          kind: "tool_call",
          ts: new Date(now - 1000),
          tool: "read",
          input: { path: "apps/orchestrator/src/agents/brainstorm.ts" },
        },
      ],
      now,
    );
    expect(r).toEqual({
      kind: "running",
      tool: "read",
      arg: "apps/orchestrator/src/agents/brainstorm.ts",
    });
  });

  it("clears once a tool_result with the same tool follows the call", () => {
    const events = [
      {
        kind: "tool_call",
        ts: new Date(now - 5000),
        tool: "bash",
        input: { command: "pnpm test" },
      },
      {
        kind: "tool_result",
        ts: new Date(now - 4000),
        tool: "bash",
      },
    ];
    expect(deriveActivity(events, now)).toBeNull();
  });

  it("flips to thinking when the call is older than 60s and unresolved", () => {
    const r = deriveActivity(
      [
        {
          kind: "tool_call",
          ts: new Date(now - 90_000),
          tool: "bash",
          input: { command: "long task" },
        },
      ],
      now,
    );
    expect(r).toEqual({ kind: "thinking" });
  });

  it("uses the latest tool_call even when an earlier same-tool call resolved", () => {
    const events = [
      {
        kind: "tool_call",
        ts: new Date(now - 10_000),
        tool: "read",
        input: { path: "first.ts" },
      },
      { kind: "tool_result", ts: new Date(now - 9_000), tool: "read" },
      {
        kind: "tool_call",
        ts: new Date(now - 1_000),
        tool: "read",
        input: { path: "second.ts" },
      },
    ];
    const r = deriveActivity(events, now);
    expect(r).toEqual({ kind: "running", tool: "read", arg: "second.ts" });
  });

  it("truncates long arg to ≤80 chars with ellipsis", () => {
    const longPath = "x".repeat(200);
    const r = deriveActivity(
      [
        {
          kind: "tool_call",
          ts: new Date(now),
          tool: "read",
          input: { path: longPath },
        },
      ],
      now,
    );
    expect(r?.kind).toBe("running");
    if (r?.kind === "running") {
      expect(r.arg.length).toBeLessThanOrEqual(80);
      expect(r.arg.endsWith("…")).toBe(true);
    }
  });

  it("summarizes bash commands and grep patterns", () => {
    expect(
      deriveActivity(
        [
          {
            kind: "tool_call",
            ts: new Date(now),
            tool: "bash",
            input: { command: "ls -la" },
          },
        ],
        now,
      ),
    ).toEqual({ kind: "running", tool: "bash", arg: "ls -la" });

    expect(
      deriveActivity(
        [
          {
            kind: "tool_call",
            ts: new Date(now),
            tool: "grep",
            input: { pattern: "TODO", path: "src/" },
          },
        ],
        now,
      ),
    ).toEqual({ kind: "running", tool: "grep", arg: "TODO" });
  });

  it("returns running with empty arg for unrecognized tool", () => {
    const r = deriveActivity(
      [
        {
          kind: "tool_call",
          ts: new Date(now),
          tool: "weird_tool",
          input: { whatever: 1 },
        },
      ],
      now,
    );
    expect(r).toEqual({ kind: "running", tool: "weird_tool", arg: "" });
  });
});

describe("ActivityLine", () => {
  it("renders nothing when activity is null", () => {
    const { container } = render(<ActivityLine activity={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders running state with tool and arg", () => {
    render(
      <ActivityLine activity={{ kind: "running", tool: "read", arg: "src/foo.ts" }} />,
    );
    const line = screen.getByTestId("activity-line");
    expect(line.textContent).toContain("read");
    expect(line.textContent).toContain("src/foo.ts");
  });

  it("renders thinking state", () => {
    render(<ActivityLine activity={{ kind: "thinking" }} />);
    expect(screen.getByText(/thinking/i)).toBeInTheDocument();
  });
});
