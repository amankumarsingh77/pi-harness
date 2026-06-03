import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Provider } from "@/lib/api";
import { StageModelSelector } from "@/components/new-task/stage-model-selector";

const unavailableProvider: Provider = {
  id: "crofai",
  name: "CrofAI",
  authenticated: false,
  auth: "api-key",
  requiredEnvVars: ["CROFAI_API_KEY"],
  models: [
    {
      id: "kimi-k2.6",
      name: "MoonshotAI: Kimi K2.6",
      reasoning: true,
      contextWindow: 262144,
      maxTokens: 262144,
      cost: { input: 0.5, output: 1.99 },
    },
  ],
};

const unavailableCatalog: { providers: Provider[] } = {
  providers: [unavailableProvider],
};

const availableCatalog: { providers: Provider[] } = {
  providers: [{ ...unavailableProvider, authenticated: true }],
};

const secondProvider: Provider = {
  ...unavailableProvider,
  id: "openai",
  name: "OpenAI",
  authenticated: true,
  requiredEnvVars: ["OPENAI_API_KEY"],
  models: [
    {
      id: "gpt-5.4",
      name: "GPT-5.4",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 120000,
      cost: { input: 1.25, output: 10 },
    },
  ],
};

const multiProviderCatalog: { providers: Provider[] } = {
  providers: [{ ...unavailableProvider, authenticated: true }, secondProvider],
};

describe("StageModelSelector", () => {
  it("renders one provider/model control for each workflow stage", () => {
    render(<StageModelSelector initialCatalog={availableCatalog} />);

    fireEvent.click(screen.getByRole("button", { name: /advanced stage routing/i }));

    for (const label of ["Brainstorm", "Planning", "Coder", "Verify", "PR"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("combobox", { name: /provider$/i })).toHaveLength(5);
    expect(screen.getAllByRole("combobox", { name: /model$/i })).toHaveLength(5);
  });

  it("exposes each workflow stage as a labelled model card", () => {
    render(<StageModelSelector initialCatalog={availableCatalog} />);

    fireEvent.click(screen.getByRole("button", { name: /advanced stage routing/i }));

    for (const label of ["Brainstorm", "Planning", "Coder", "Verify", "PR"]) {
      const card = screen.getByRole("article", { name: `${label} model stage` });
      expect(card).toHaveTextContent(label);
      expect(card).toHaveTextContent("MoonshotAI: Kimi K2.6");
    }
  });

  it("disables creation and warns when a selected provider is missing env vars", () => {
    render(<StageModelSelector initialCatalog={unavailableCatalog} />);

    expect(screen.getByRole("button", { name: "Create task" })).toBeDisabled();
    expect(screen.getByRole("alert", { name: "Provider credentials required" })).toBeInTheDocument();
    expect(screen.getByText(/CROFAI_API_KEY/)).toBeInTheDocument();
  });

  it("keeps phaseModels payload in sync when provider and model selections change", () => {
    const { container } = render(<StageModelSelector initialCatalog={multiProviderCatalog} />);

    fireEvent.click(screen.getByRole("button", { name: /advanced stage routing/i }));
    fireEvent.change(screen.getByRole("combobox", { name: "Brainstorm provider" }), {
      target: { value: "openai" },
    });

    const input = container.querySelector<HTMLInputElement>('input[name="phaseModels"]');
    expect(input).not.toBeNull();
    expect(JSON.parse(input?.value ?? "{}")).toMatchObject({
      brainstorm: { provider: "openai", model: "gpt-5.4" },
    });

    const card = screen.getByRole("article", { name: "Brainstorm model stage" });
    expect(within(card).getByRole("combobox", { name: "Brainstorm model" })).toHaveValue("gpt-5.4");
    expect(screen.getByRole("button", { name: /advanced stage routing/i })).toHaveTextContent("custom");
  });

  it("applies model routing presets without changing the phaseModels field shape", () => {
    const catalog: { providers: Provider[] } = {
      providers: [
        {
          ...unavailableProvider,
          authenticated: true,
          models: [
            {
              id: "large-reasoning",
              name: "Large Reasoning",
              reasoning: true,
              contextWindow: 300000,
              maxTokens: 120000,
              cost: { input: 2, output: 10 },
            },
            {
              id: "fast-mini",
              name: "Fast Mini",
              reasoning: false,
              contextWindow: 64000,
              maxTokens: 16000,
              cost: { input: 0.1, output: 0.3 },
            },
          ],
        },
      ],
    };
    const { container } = render(<StageModelSelector initialCatalog={catalog} />);

    fireEvent.click(screen.getByRole("button", { name: /fast/i }));

    const input = container.querySelector<HTMLInputElement>('input[name="phaseModels"]');
    expect(input).not.toBeNull();
    expect(JSON.parse(input?.value ?? "{}")).toMatchObject({
      brainstorm: { provider: "crofai", model: "fast-mini", thinkingLevel: "low" },
      pr: { provider: "crofai", model: "fast-mini", thinkingLevel: "off" },
    });
  });

  it("refreshes credential state without clearing surrounding form input", async () => {
    const fetchMock = vi.fn().mockResolvedValue(availableCatalog);

    render(
      <form>
        <input aria-label="Title" defaultValue="Keep this title" />
        <textarea aria-label="Description" defaultValue="Keep this description" />
        <StageModelSelector initialCatalog={unavailableCatalog} fetchCatalog={fetchMock} />
      </form>,
    );

    const title = screen.getByLabelText("Title");
    const description = screen.getByLabelText("Description");
    fireEvent.change(title, { target: { value: "Edited title" } });
    fireEvent.change(description, { target: { value: "Edited description" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(title).toHaveValue("Edited title");
    expect(description).toHaveValue("Edited description");
    await waitFor(() => expect(screen.getByRole("button", { name: "Create task" })).toBeEnabled());
  });
});
