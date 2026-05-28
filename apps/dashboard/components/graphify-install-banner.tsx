"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { GraphifyInstallState } from "@pi-harness/shared";
import { queries } from "@/lib/client/queries";

const READY_VISIBLE_MS = 30_000;

export function GraphifyInstallBanner() {
  const { data } = useQuery(queries.getGraphifyStatus());
  const status = data?.status ?? null;
  const view = useMemo(() => viewForStatus(status), [status]);

  if (!view) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 max-w-sm px-3">
      <div
        role={view.role}
        className={[
          "rounded-md border px-4 py-3 text-sm shadow-lg",
          view.className,
        ].join(" ")}
      >
        <div className="font-medium">{view.title}</div>
        {view.message ? (
          <div className="mt-1 break-words text-xs opacity-80">{view.message}</div>
        ) : null}
      </div>
    </div>
  );
}

function viewForStatus(status: GraphifyInstallState | null): {
  readonly role: "status" | "alert";
  readonly title: string;
  readonly message?: string;
  readonly className: string;
} | null {
  if (!status) return null;
  if (status.status === "installing") {
    return {
      role: "status",
      title: "Installing Graphify...",
      message: "Agents will continue without graph context until it is ready.",
      className: "border-amber-300 bg-amber-50 text-amber-950",
    };
  }
  if (status.status === "install_failed") {
    const message = status.message ?? status.stderrTail;
    return {
      role: "alert",
      title: "Graphify install failed",
      ...(message ? { message } : {}),
      className: "border-red-300 bg-red-50 text-red-950",
    };
  }
  if (status.status === "config_required") {
    return {
      role: "alert",
      title: "Graphify provider key required",
      message: status.message ?? "Set the configured Graphify provider key to enable graph context.",
      className: "border-amber-300 bg-amber-50 text-amber-950",
    };
  }
  if (Date.now() - status.updatedAt.getTime() > READY_VISIBLE_MS) return null;
  return {
    role: "status",
    title: "Graphify ready",
    className: "border-emerald-300 bg-emerald-50 text-emerald-950",
  };
}
