type WorktreeManagerLike = {
  list: () => Promise<{ taskId: string; path: string; branch: string }[]>;
  remove: (taskId: string) => Promise<void>;
};

export type ReconcileReport = {
  kept: string[];
  removed: string[];
};

// Walks all on-disk worktrees and removes any whose task is no longer active
// (terminal status or missing entirely). Run this at orchestrator boot.
export async function reconcileWorktrees(opts: {
  worktreeManager: WorktreeManagerLike;
  activeTaskIds: Set<string>;
}): Promise<ReconcileReport> {
  const present = await opts.worktreeManager.list();
  const kept: string[] = [];
  const removed: string[] = [];
  for (const wt of present) {
    if (opts.activeTaskIds.has(wt.taskId)) {
      kept.push(wt.taskId);
    } else {
      await opts.worktreeManager.remove(wt.taskId);
      removed.push(wt.taskId);
    }
  }
  return { kept, removed };
}
