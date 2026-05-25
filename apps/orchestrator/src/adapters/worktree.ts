import { existsSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { WorktreeError } from "../domain/errors.js";

export type WorktreeInfo = {
  taskId: string;
  path: string;
  branch: string;
};

export type WorktreeManagerOptions = {
  repoRoot: string;
  worktreesDir: string;
  baseBranch?: string;
};

// Owns the lifecycle of git worktrees, one per task. Spec §5.
//
// NOTE: this is the *one* abstraction we own over git. We do not delegate to
// pi-subagents' worktree option because the orchestrator needs to track
// worktrees independent of any specific subagent run (see janitor — Task 13).
export class WorktreeManager {
  private readonly git: SimpleGit;
  private readonly opts: {
    readonly repoRoot: string;
    readonly worktreesDir: string;
    readonly baseBranch: string;
  };

  constructor(opts: WorktreeManagerOptions) {
    // Resolve symlinks so comparisons against `git worktree list --porcelain`
    // output (which reports canonical paths, e.g. `/private/var/...` on macOS)
    // succeed.
    const canonical = (p: string): string => {
      const abs = resolve(p);
      try {
        return realpathSync(abs);
      } catch {
        return abs;
      }
    };
    this.opts = {
      repoRoot: canonical(opts.repoRoot),
      worktreesDir: canonical(opts.worktreesDir),
      baseBranch: opts.baseBranch ?? "main",
    };
    this.git = simpleGit(this.opts.repoRoot);
  }

  pathFor(taskId: string): string {
    return join(this.opts.worktreesDir, taskId);
  }

  async create(taskId: string, branch: string): Promise<WorktreeInfo> {
    const path = this.pathFor(taskId);
    if (existsSync(path)) {
      throw new WorktreeError(`worktree already exists for ${taskId}`, { path });
    }
    await mkdir(this.opts.worktreesDir, { recursive: true });
    try {
      // Anchor new worktrees to `main` explicitly. Without a start point, git
      // branches from the repo root's current HEAD — so when the orchestrator
      // runs from a feature branch, the worktree diverges from that branch and
      // `git diff main...` sweeps in every commit between `main` and the host
      // branch, polluting the "Files touched" list.
      await this.git.raw(["worktree", "add", "-b", branch, path, this.opts.baseBranch]);
    } catch (e) {
      throw new WorktreeError(`git worktree add failed: ${(e as Error).message}`, {
        taskId,
        branch,
        path,
      });
    }
    return { taskId, path, branch };
  }

  // Idempotent variant — returns the existing worktree if one is already
  // registered for this task, otherwise creates one. Phase entry points use
  // this so re-dispatch of the same phase (e.g., brainstorm resume after
  // "request changes") doesn't crash on the duplicate-create check.
  async ensure(taskId: string, branch: string): Promise<WorktreeInfo> {
    const path = this.pathFor(taskId);
    if (existsSync(path)) {
      // Trust the existing worktree; we don't try to validate that its branch
      // matches because git won't let two worktrees share a branch anyway.
      return { taskId, path, branch };
    }
    const existing = await this.findByBranch(branch);
    if (existing) {
      return { taskId, path: existing.path, branch };
    }
    if (await this.branchExists(branch)) {
      await mkdir(this.opts.worktreesDir, { recursive: true });
      try {
        await this.git.raw(["worktree", "add", path, branch]);
      } catch (e) {
        throw new WorktreeError(`git worktree add failed: ${(e as Error).message}`, {
          taskId,
          branch,
          path,
        });
      }
      return { taskId, path, branch };
    }
    return this.create(taskId, branch);
  }

  async remove(taskId: string): Promise<void> {
    const path = this.pathFor(taskId);
    if (!existsSync(path)) return;
    try {
      await this.git.raw(["worktree", "remove", "--force", path]);
    } catch (e) {
      throw new WorktreeError(`git worktree remove failed: ${(e as Error).message}`, {
        taskId,
        path,
      });
    }
  }

  async list(): Promise<WorktreeInfo[]> {
    const all = await this.allWorktrees();
    // Re-resolve managed dir now that it likely exists post-create(); git
    // emits canonical paths (e.g. /private/var/... on macOS) so a non-canonical
    // prefix would fail the startsWith check.
    let managedDir = this.opts.worktreesDir;
    try {
      managedDir = realpathSync(managedDir);
    } catch {
      // dir doesn't exist yet — keep the resolved absolute path
    }
    return all
      .filter((wt) => wt.path !== this.opts.repoRoot)
      .filter((wt) => wt.path.startsWith(managedDir))
      .map((wt) => ({
        taskId: wt.path.slice(managedDir.length + 1),
        path: wt.path,
        branch: wt.branch,
      }));
  }

  private async branchExists(branch: string): Promise<boolean> {
    try {
      await this.git.raw(["rev-parse", "--verify", `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  private async findByBranch(branch: string): Promise<{ path: string; branch: string } | null> {
    return (await this.allWorktrees()).find((wt) => wt.branch === branch) ?? null;
  }

  private async allWorktrees(): Promise<Array<{ path: string; branch: string }>> {
    const raw = await this.git.raw(["worktree", "list", "--porcelain"]);
    const blocks = raw.split("\n\n").filter((b) => b.trim().length > 0);
    const out: Array<{ path: string; branch: string }> = [];
    for (const block of blocks) {
      const lines = block.split("\n");
      const wtPathLine = lines.find((l) => l.startsWith("worktree "));
      const branchLine = lines.find((l) => l.startsWith("branch "));
      if (!wtPathLine) continue;
      const path = wtPathLine.slice("worktree ".length);
      const branch = branchLine?.startsWith("branch refs/heads/")
        ? branchLine.slice("branch refs/heads/".length)
        : "(detached)";
      out.push({ path, branch });
    }
    return out;
  }
}
