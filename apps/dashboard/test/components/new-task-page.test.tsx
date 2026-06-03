import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Provider } from "@/lib/api";
import NewTaskPage from "@/app/tasks/new/page";

const availableProvider = vi.hoisted<Provider>(() => ({
  id: "crofai",
  name: "CrofAI",
  authenticated: true,
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
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/new",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/server/api", () => ({
  orchestrator: {
    listTasks: vi.fn().mockResolvedValue({
      counts: {
        brainstorming: 1,
        planning: 0,
        executing: 0,
        verifying: 0,
      },
    }),
    getProviders: vi.fn().mockResolvedValue({ providers: [availableProvider] }),
  },
}));

vi.mock("@/app/tasks/new/actions", () => ({
  createTask: vi.fn(),
}));

describe("NewTaskPage", () => {
  it("renders a labelled task creation form with recovery-safe navigation", async () => {
    render(await NewTaskPage());

    expect(screen.getByRole("heading", { name: "Create a task" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Create task form" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Board" })).toHaveAttribute("href", "/");
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create task" })).toHaveAttribute("type", "submit");
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("region", { name: "Stage model routing" })).toBeInTheDocument();
  });
});
