import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GraphifyKnowledge } from "@/components/knowledge/graphify-knowledge";
import type { GraphifyStatus } from "@/lib/api";

describe("GraphifyKnowledge", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/actions/update")) {
          return Response.json({
            ...status,
            job: {
              status: "running",
              action: "update",
              startedAt: "2026-06-06T00:00:00.000Z",
              completedAt: null,
              error: null,
            },
          });
        }
        if (url.includes("/status")) return Response.json(status);
        if (url.includes("/report")) return new Response("# Graph report");
        return Response.json({});
      }),
    );
  });

  it("renders status and the markdown report", () => {
    renderKnowledge();

    expect(screen.getByRole("heading", { name: "Knowledge" })).toBeInTheDocument();
    expect(screen.getByText("0.8.32")).toBeInTheDocument();
    expect(screen.getByText("Graph report")).toBeInTheDocument();
  });

  it("switches to the sandboxed interactive graph iframe", () => {
    renderKnowledge();

    fireEvent.click(screen.getByRole("button", { name: /Interactive Graph/ }));

    const iframe = screen.getByTitle("Interactive Graph");
    expect(iframe).toHaveAttribute("src", "/api/proxy/graphify/artifacts/html");
    expect(iframe).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");
  });

  it("shows an empty report state when the report artifact is missing", () => {
    renderKnowledge({
      initialStatus: { ...status, reportExists: false },
      initialReport: null,
    });

    expect(screen.getByText("Graphify report is not available yet")).toBeInTheDocument();
    expect(screen.queryByText("Loading report")).not.toBeInTheDocument();
  });

  it("runs the update action through the proxied API", async () => {
    const fetchSpy = vi.mocked(fetch);
    renderKnowledge();

    fireEvent.click(screen.getByRole("button", { name: "Update graph" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/proxy/graphify/actions/update",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});

const status: GraphifyStatus = {
  enabled: true,
  bootstrap: true,
  installed: true,
  version: "0.8.32",
  minVersion: "0.8.32",
  graphExists: true,
  reportExists: true,
  htmlExists: true,
  callflowExists: true,
  treeExists: false,
  jsonBytes: 4096,
  job: {
    status: "idle",
    action: null,
    startedAt: null,
    completedAt: null,
    error: null,
  },
};

function renderKnowledge(
  opts: {
    readonly initialStatus?: GraphifyStatus;
    readonly initialReport?: string | null;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GraphifyKnowledge
        initialStatus={opts.initialStatus ?? status}
        initialReport={"initialReport" in opts ? opts.initialReport ?? null : "# Graph report"}
      />
    </QueryClientProvider>,
  );
}
