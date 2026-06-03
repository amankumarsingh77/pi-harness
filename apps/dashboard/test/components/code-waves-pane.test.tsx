import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CodeNodeDetail } from "@/components/code/code-node-detail";
import { CodeWavesPane } from "@/components/code/code-waves-pane";
import { parseExecutionDag } from "@/lib/code/parse-execution-dag";
import { deriveCodeState } from "@/lib/code/derive-code-state";
import {
  CODE_DAG_BODY,
  at,
  resetEventSeq,
  nodeStarted,
  nodeEnded,
  message,
} from "../code/fixtures";

const dag = parseExecutionDag(CODE_DAG_BODY);

beforeEach(() => resetEventSeq());

function midRunState() {
  return deriveCodeState(dag, [
    nodeStarted("C-1", at(1)),
    nodeEnded("C-1", "succeeded", at(3), { commitSha: "a1b2c3d4" }),
    nodeStarted("C-2", at(1)),
    nodeEnded("C-2", "succeeded", at(3), { commitSha: "deadbeef" }),
    nodeStarted("C-5", at(4)),
    message("C-5", "editing src/agents/code.ts", at(5)),
  ]);
}

describe("CodeWavesPane", () => {
  it("renders waves in order with their names", () => {
    const state = midRunState();
    render(
      <CodeWavesPane
        waves={state.waves}
        metrics={state.metrics}
        selectedNodeId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("Scaffolding")).toBeInTheDocument();
    expect(screen.getByText("Runner")).toBeInTheDocument();
  });

  it("shows each node's status via an accessible status icon", () => {
    const state = midRunState();
    render(
      <CodeWavesPane
        waves={state.waves}
        metrics={state.metrics}
        selectedNodeId={null}
        onSelect={() => {}}
      />,
    );
    const c5Row = screen.getByText("C-5").closest("[data-testid='code-node-row']");
    expect(c5Row).not.toBeNull();
    expect(within(c5Row as HTMLElement).getByRole("img", { name: "running" })).toBeInTheDocument();
  });

  it("renders one purposeful sub-line per node", () => {
    const state = midRunState();
    render(
      <CodeWavesPane
        waves={state.waves}
        metrics={state.metrics}
        selectedNodeId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("committed a1b2c3d")).toBeInTheDocument();
    expect(screen.getByText("editing src/agents/code.ts")).toBeInTheDocument();
  });

  it("calls onSelect with the node id when a row is clicked", () => {
    const state = midRunState();
    const onSelect = vi.fn();
    render(
      <CodeWavesPane
        waves={state.waves}
        metrics={state.metrics}
        selectedNodeId={null}
        onSelect={onSelect}
      />,
    );
    const c5Row = screen.getByText("C-5").closest("[data-testid='code-node-row']");
    fireEvent.click(c5Row as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith("C-5");
  });

  it("marks the selected row as pressed", () => {
    const state = midRunState();
    render(
      <CodeWavesPane
        waves={state.waves}
        metrics={state.metrics}
        selectedNodeId="C-5"
        onSelect={() => {}}
      />,
    );
    const c5Row = screen.getByText("C-5").closest("[data-testid='code-node-row']");
    expect(c5Row).toHaveAttribute("aria-pressed", "true");
  });

  it("shows an empty state when there are no waves", () => {
    render(
      <CodeWavesPane
        waves={[]}
        metrics={deriveCodeState(parseExecutionDag(""), []).metrics}
        selectedNodeId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText(/not authored yet/i)).toBeInTheDocument();
  });

  it("shows a recovery path when the DAG has not been authored", () => {
    render(<CodeNodeDetail node={null} taskId="T-1" dagEmpty />);
    expect(screen.getByRole("region", { name: "No execution DAG authored" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open plan" })).toHaveAttribute("href", "/tasks/T-1/plan");
  });
});
