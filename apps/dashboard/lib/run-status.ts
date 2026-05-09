import type { StatusKind } from "@/components/kanban/status-icon";
import type { MockRun } from "@/types/mocks";

export function statusKindForRun(run: MockRun): StatusKind {
  switch (run.outcome.kind) {
    case "running":
      return "progress";
    case "blocked":
    case "failed":
    case "abandoned":
      return "blocked";
    case "review":
      return "review";
    case "shipping":
      return "shipping";
    case "merged":
      return "done";
  }
}
