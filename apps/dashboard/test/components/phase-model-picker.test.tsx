import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhaseModelPicker } from "@/components/new-task/phase-model-picker";
import type { ModelCatalog } from "@pi-harness/shared";

const catalog: ModelCatalog = {
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

  it("changes provider and model for only the selected phase", async () => {
    const user = userEvent.setup();
    render(<PhaseModelPicker catalog={catalog} />);

    await user.selectOptions(screen.getByLabelText("Brainstorm provider"), "openai");

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
