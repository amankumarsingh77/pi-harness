import type { Phase, Workflow } from "@pi-harness/shared";

const CHAINS: Record<Workflow, readonly Phase[]> = {
  "backend-feature": ["brainstorm", "plan", "code", "verify", "pr"],
};

export function phasesFor(workflow: Workflow): readonly Phase[] {
  return CHAINS[workflow];
}

export function nextPhase(workflow: Workflow, current: Phase): Phase | null {
  const chain = CHAINS[workflow];
  const i = chain.indexOf(current);
  if (i === -1) {
    throw new Error(`phase ${current} is not in workflow ${workflow}`);
  }
  return chain[i + 1] ?? null;
}

export function isLastPhase(workflow: Workflow, phase: Phase): boolean {
  return nextPhase(workflow, phase) === null;
}
