import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphifyInstallBanner } from "@/components/graphify-install-banner";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GraphifyInstallBanner", () => {
  it("shows an automatic installing status without install controls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json({
        status: {
          status: "installing",
          reason: "missing_cli",
          message: "Graphify CLI not found",
          updatedAt: new Date().toISOString(),
        },
      }),
    ));

    renderWithQueryClient(<GraphifyInstallBanner />);

    expect(await screen.findByText("Installing Graphify...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /install/i })).not.toBeInTheDocument();
  });

  it("shows install failures without blocking the rest of the dashboard", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json({
        status: {
          status: "install_failed",
          reason: "incompatible_cli",
          message: "Automatic install could not complete",
          stderrTail: "uv failed",
          updatedAt: new Date().toISOString(),
        },
      }),
    ));

    renderWithQueryClient(
      <>
        <button type="button">Start task</button>
        <GraphifyInstallBanner />
      </>,
    );

    expect(await screen.findByText("Graphify install failed")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start task" })).toBeEnabled());
  });

  it("shows provider configuration failures without install controls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json({
        status: {
          status: "config_required",
          reason: "missing_provider_key",
          message: "Graphify provider 'crofai' requires CROFAI_API_KEY for semantic extraction.",
          updatedAt: new Date().toISOString(),
        },
      }),
    ));

    renderWithQueryClient(<GraphifyInstallBanner />);

    expect(await screen.findByText("Graphify provider key required")).toBeInTheDocument();
    expect(screen.getByText(/CROFAI_API_KEY/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /install/i })).not.toBeInTheDocument();
  });
});

function renderWithQueryClient(node: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
