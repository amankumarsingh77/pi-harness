import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { RunsDashboard } from "@/components/runs/runs-dashboard";
import { MOCK_RUNS, isActive } from "@/lib/server/_fixtures/runs";

export const metadata: Metadata = { title: "Runs · pi-harness" };

export default function RunsPage() {
  const active = MOCK_RUNS.filter(isActive);
  const recent = MOCK_RUNS.filter((r) => !isActive(r));
  const running = MOCK_RUNS.filter((r) => r.outcome.kind === "running").length;
  const blocked = MOCK_RUNS.filter((r) => r.outcome.kind === "blocked").length;
  const doneToday = MOCK_RUNS.filter(
    (r) => r.outcome.kind === "merged" && r.startedAt.startsWith("2026-05-09"),
  ).length;

  return (
    <>
      <Topbar runningCount={running} blockedCount={blocked} doneTodayCount={doneToday} branch="main" />
      <RunsDashboard active={active} recent={recent} />
    </>
  );
}
