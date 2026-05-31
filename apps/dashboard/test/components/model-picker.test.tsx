/**
 * Tests for model-picker and thinking-picker components (Step 2).
 * TDD: tests written first, implementations follow.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModelPicker } from "@/components/chat/model-picker";
import { ThinkingPicker } from "@/components/chat/thinking-picker";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const providers = [
  {
    id: "crofai",
    name: "CrofAI",
    authenticated: true,
    models: [
      {
        id: "kimi-k2.6",
        name: "Kimi K2.6",
        contextWindow: "262K",
        costIn: "$0.50",
        costOut: "$1.99",
        reasoning: true,
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        contextWindow: "1M",
        costIn: "$0.40",
        costOut: "$0.85",
        reasoning: true,
      },
    ],
  },
  {
    id: "openai-codex",
    name: "OpenAI · Codex",
    authenticated: false,
    models: [
      {
        id: "gpt-5-codex",
        name: "GPT-5 Codex",
        contextWindow: "400K",
        costIn: "",
        costOut: "",
        reasoning: true,
      },
    ],
  },
];

// ── ModelPicker ───────────────────────────────────────────────────────────────

describe("ModelPicker", () => {
  it("renders the trigger chip with selected provider/model label (REQ-040)", () => {
    render(
      <ModelPicker
        providers={providers}
        selected={{ provider: "crofai", model: "deepseek-v4-pro" }}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /crofai.*deepseek-v4-pro/i })).toBeInTheDocument();
  });

  it("opens dropdown when trigger is clicked (REQ-040)", () => {
    render(
      <ModelPicker
        providers={providers}
        selected={{ provider: "crofai", model: "deepseek-v4-pro" }}
        onSelect={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: /crofai.*deepseek-v4-pro/i });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("closes on Escape key (REQ-040)", () => {
    render(
      <ModelPicker
        providers={providers}
        selected={{ provider: "crofai", model: "deepseek-v4-pro" }}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /crofai.*deepseek-v4-pro/i }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes on mousedown outside the picker (REQ-040)", () => {
    render(
      <div>
        <ModelPicker
          providers={providers}
          selected={{ provider: "crofai", model: "deepseek-v4-pro" }}
          onSelect={vi.fn()}
        />
        <div data-testid="outside">Outside</div>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /crofai.*deepseek-v4-pro/i }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside"));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("calls onSelect with provider+model when option is selected (REQ-041)", () => {
    const onSelect = vi.fn();
    render(
      <ModelPicker
        providers={providers}
        selected={{ provider: "crofai", model: "deepseek-v4-pro" }}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /crofai.*deepseek-v4-pro/i }));
    const option = screen.getByRole("option", { name: /Kimi K2\.6/i });
    fireEvent.click(option);

    expect(onSelect).toHaveBeenCalledWith("crofai", "kimi-k2.6");
  });

  it("closes dropdown after selection (REQ-041)", () => {
    render(
      <ModelPicker
        providers={providers}
        selected={{ provider: "crofai", model: "deepseek-v4-pro" }}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /crofai.*deepseek-v4-pro/i }));
    fireEvent.click(screen.getByRole("option", { name: /Kimi K2\.6/i }));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("filters options by search query (REQ-040)", () => {
    render(
      <ModelPicker
        providers={providers}
        selected={{ provider: "crofai", model: "deepseek-v4-pro" }}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /crofai.*deepseek-v4-pro/i }));
    const searchInput = screen.getByPlaceholderText(/search models/i);
    fireEvent.change(searchInput, { target: { value: "kimi" } });

    expect(screen.getByRole("option", { name: /Kimi K2\.6/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /GPT-5/i })).not.toBeInTheDocument();
  });

  it("marks unauthenticated providers with sign-in marker (REQ-044)", () => {
    render(
      <ModelPicker
        providers={providers}
        selected={{ provider: "crofai", model: "deepseek-v4-pro" }}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /crofai.*deepseek-v4-pro/i }));

    expect(screen.getByTestId("auth-off-openai-codex")).toBeInTheDocument();
    expect(screen.getByText(/sign in/i)).toBeInTheDocument();
  });

  it("marks authenticated providers as connected (REQ-044)", () => {
    render(
      <ModelPicker
        providers={providers}
        selected={{ provider: "crofai", model: "deepseek-v4-pro" }}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /crofai.*deepseek-v4-pro/i }));

    expect(screen.getByTestId("auth-ok-crofai")).toBeInTheDocument();
  });

  it("shows reasoning tag for models with reasoning capability (REQ-040)", () => {
    render(
      <ModelPicker
        providers={providers}
        selected={{ provider: "crofai", model: "deepseek-v4-pro" }}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /crofai.*deepseek-v4-pro/i }));

    const reasoningTags = screen.getAllByText("reasoning");
    expect(reasoningTags.length).toBeGreaterThan(0);
  });

  it("marks selected option with aria-selected=true (REQ-041)", () => {
    render(
      <ModelPicker
        providers={providers}
        selected={{ provider: "crofai", model: "deepseek-v4-pro" }}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /crofai.*deepseek-v4-pro/i }));

    const selected = screen.getByRole("option", { name: /DeepSeek V4 Pro/i });
    expect(selected).toHaveAttribute("aria-selected", "true");
  });

  it("has aria-haspopup=listbox on trigger (REQ-040)", () => {
    render(
      <ModelPicker
        providers={providers}
        selected={{ provider: "crofai", model: "deepseek-v4-pro" }}
        onSelect={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: /crofai.*deepseek-v4-pro/i });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
  });
});

// ── ThinkingPicker ────────────────────────────────────────────────────────────

describe("ThinkingPicker", () => {
  it("renders trigger with current level (REQ-042)", () => {
    render(<ThinkingPicker level="medium" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /thinking.*medium/i })).toBeInTheDocument();
  });

  it("opens dropdown with all 4 levels (REQ-042)", () => {
    render(<ThinkingPicker level="medium" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /thinking/i }));

    // Each level shows as a separate option – match by data-value testid
    expect(screen.getByTestId("think-opt-off")).toBeInTheDocument();
    expect(screen.getByTestId("think-opt-low")).toBeInTheDocument();
    expect(screen.getByTestId("think-opt-medium")).toBeInTheDocument();
    expect(screen.getByTestId("think-opt-high")).toBeInTheDocument();
  });

  it("marks selected level with aria-selected=true (REQ-042)", () => {
    render(<ThinkingPicker level="medium" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /thinking/i }));

    expect(screen.getByTestId("think-opt-medium")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("think-opt-off")).toHaveAttribute("aria-selected", "false");
  });

  it("calls onSelect with chosen level (REQ-042)", () => {
    const onSelect = vi.fn();
    render(<ThinkingPicker level="medium" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /thinking/i }));
    fireEvent.click(screen.getByTestId("think-opt-high"));

    expect(onSelect).toHaveBeenCalledWith("high");
  });

  it("closes after selection (REQ-042)", () => {
    render(<ThinkingPicker level="medium" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /thinking/i }));
    fireEvent.click(screen.getByTestId("think-opt-off"));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes on Escape (REQ-042)", () => {
    render(<ThinkingPicker level="medium" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /thinking/i }));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("shows descriptions for each level", () => {
    render(<ThinkingPicker level="medium" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /thinking/i }));

    expect(screen.getByText(/No reasoning/i)).toBeInTheDocument();
    expect(screen.getByText(/Brief reasoning/i)).toBeInTheDocument();
    expect(screen.getByText(/Balanced/i)).toBeInTheDocument();
    expect(screen.getByText(/Deep reasoning/i)).toBeInTheDocument();
  });
});
