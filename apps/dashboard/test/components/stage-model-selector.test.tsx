import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ModelCatalog, ModelCatalogProvider } from "@/lib/api";
import { StageModelSelector } from "@/components/new-task/stage-model-selector";

const unavailableProvider: ModelCatalogProvider = {
  id: "crofai",
  label: "CrofAI",
  credential: {
    kind: "env",
    configured: false,
    requiredEnvVars: ["CROFAI_API_KEY"],
  },
  models: [
    {
      id: "kimi-k2.6",
      label: "MoonshotAI: Kimi K2.6",
      reasoning: true,
      contextWindow: 262144,
      maxTokens: 262144,
    },
  ],
};

const unavailableCatalog: ModelCatalog = {
  providers: [unavailableProvider],
};

const availableCatalog: ModelCatalog = {
  providers: [
    {
      ...unavailableProvider,
      credential: {
        kind: "env",
        configured: true,
        requiredEnvVars: ["CROFAI_API_KEY"],
      },
    },
  ],
};

describe("StageModelSelector", () => {
  it("renders one provider/model control for each workflow stage", () => {
    render(<StageModelSelector initialCatalog={availableCatalog} />);

    for (const label of ["Brainstorm", "Planning", "Coder", "Verify", "PR"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("combobox", { name: /provider$/i })).toHaveLength(5);
    expect(screen.getAllByRole("combobox", { name: /model$/i })).toHaveLength(5);
  });

  it("disables creation and warns when a selected provider is missing env vars", () => {
    render(<StageModelSelector initialCatalog={unavailableCatalog} />);

    expect(screen.getByRole("button", { name: "Create task" })).toBeDisabled();
    expect(screen.getByText("Provider key required")).toBeInTheDocument();
    expect(screen.getByText(/CROFAI_API_KEY/)).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Create task" })).toBeEnabled();
  });
});
