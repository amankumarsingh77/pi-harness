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
};

// Owns the lifecycle of git worktrees, one per task. Spec §5.
//
// NOTE: this is the *one* abstraction we own over git. We do not delegate to
// pi-subagents' worktree option because the orchestrator needs to track
// worktrees independent of any specific subagent run (see janitor — Task 13).
export class WorktreeManager {
  private readonly git: SimpleGit;
  private readonly opts: WorktreeManagerOptions;

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
      // `-b <branch>` creates the branch; defaults to HEAD as the start point.
      await this.git.raw(["worktree", "add", "-b", branch, path]);
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
    const raw = await this.git.raw(["worktree", "list", "--porcelain"]);
    const blocks = raw.split("\n\n").filter((b) => b.trim().length > 0);
    // Re-resolve managed dir now that it likely exists post-create(); git
    // emits canonical paths (e.g. /private/var/... on macOS) so a non-canonical
    // prefix would fail the startsWith check.
    let managedDir = this.opts.worktreesDir;
    try {
      managedDir = realpathSync(managedDir);
    } catch {
      // dir doesn't exist yet — keep the resolved absolute path
    }
    const out: WorktreeInfo[] = [];
    for (const block of blocks) {
      const lines = block.split("\n");
      const wtPathLine = lines.find((l) => l.startsWith("worktree "));
      const branchLine = lines.find((l) => l.startsWith("branch "));
      if (!wtPathLine) continue;
      const path = wtPathLine.slice("worktree ".length);
      // Skip the main repo's own worktree.
      if (path === this.opts.repoRoot) continue;
      // Only include worktrees under our managed dir.
      if (!path.startsWith(managedDir)) continue;
      const branch = branchLine ? branchLine.slice("branch refs/heads/".length) : "(detached)";
      const taskId = path.slice(managedDir.length + 1);
      out.push({ taskId, path, branch });
    }
    return out;
  }
}
