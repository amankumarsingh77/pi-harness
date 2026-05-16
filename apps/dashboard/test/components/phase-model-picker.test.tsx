import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PhaseModelPicker } from "@/components/new-task/phase-model-picker";
import type { ModelCatalog } from "@pi-harness/shared";

const catalog: ModelCatalog = {
  phases: ["brainstorm", "plan", "code", "verify", "pr"],
  thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
  defaults: {
    brainstorm: { provider: "crofai", model: "kimi-k2.6", thinkingLevel: "medium" },
    plan: { provider: "crofai", model: "kimi-k2.6", thinkingLevel: "high" },
    code: { provider: "crofai", model: "kimi-k2.6", thinkingLevel: "medium" },
    verify: { provider: "crofai", model: "kimi-k2.6", thinkingLevel: "high" },
    pr: { provider: "crofai", model: "kimi-k2.6", thinkingLevel: "off" },
  },
  providers: [
    {
      id: "crofai",
      name: "CrofAI",
      authStatus: { configured: true, source: "environment" },
      models: [
        {
          id: "kimi-k2.6",
          name: "Kimi K2.6",
          reasoning: true,
          thinkingLevels: ["off", "medium", "high"],
          contextWindow: 262144,
          maxTokens: 262144,
          cost: { input: 0.5, output: 1.99, cacheRead: 0.1, cacheWrite: 0 },
        },
      ],
    },
    {
      id: "openai",
      name: "OpenAI",
      authStatus: { configured: false },
      models: [
        {
          id: "gpt-x",
          name: "GPT X",
          reasoning: false,
          thinkingLevels: ["off"],
          contextWindow: 128000,
          maxTokens: 8192,
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    },
  ],
};

describe("PhaseModelPicker", () => {
  it("renders one row per phase", () => {
    render(<PhaseModelPicker catalog={catalog} />);

    for (const phase of ["Brainstorm", "Plan", "Code", "Verify", "PR"]) {
      expect(screen.getByText(phase)).toBeInTheDocument();
    }
  });

  it("shows provider auth status in the provider selector", () => {
    render(<PhaseModelPicker catalog={catalog} />);

    expect(screen.getAllByRole("option", { name: "CrofAI (auth ready)" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("option", { name: "OpenAI (missing auth)" }).length).toBeGreaterThan(0);
  });

  it("changes provider and model for only the selected phase", () => {
    render(<PhaseModelPicker catalog={catalog} />);

    fireEvent.change(screen.getByLabelText("Brainstorm provider"), { target: { value: "openai" } });

    const hidden = screen.getByDisplayValue(/\{"brainstorm"/);
    expect(hidden).toHaveAttribute("name", "phaseModels");
    expect(hidden).toHaveAttribute(
      "value",
      expect.stringContaining('"brainstorm":{"provider":"openai","model":"gpt-x","thinkingLevel":"off"}'),
    );
    expect(hidden).toHaveAttribute(
      "value",
      expect.stringContaining('"plan":{"provider":"crofai","model":"kimi-k2.6","thinkingLevel":"high"}'),
    );
  });
});
