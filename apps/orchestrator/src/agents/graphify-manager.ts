import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const GRAPHIFY_INSTALL_HINT = `Install Graphify with: uv tool install "graphifyy[mcp]"`;

export type GraphifyReason =
  | "startup"
  | "worktree_first_phase"
  | "code_commit"
  | "agent_refresh";

export type GraphifyStatus = {
  readonly graphPath: string;
  readonly exists: boolean;
  readonly valid: boolean;
  readonly nodeCount: number | null;
  readonly edgeCount: number | null;
  readonly error?: string;
};

export type GraphifyRunResult =
  | {
      readonly ok: true;
      readonly action: "initialize" | "update";
      readonly cwd: string;
      readonly status: GraphifyStatus;
      readonly stdout: string;
      readonly stderr: string;
      readonly skipped: boolean;
    }
  | {
      readonly ok: false;
      readonly action: "initialize" | "update";
      readonly cwd: string;
      readonly code: "missing_cli" | "command_failed" | "invalid_graph";
      readonly message: string;
      readonly stdout: string;
      readonly stderr: string;
      readonly status?: GraphifyStatus;
    };

export interface GraphifyLifecycle {
  ensureInitialized(cwd: string): Promise<GraphifyRunResult>;
  update(cwd: string, reason: GraphifyReason): Promise<GraphifyRunResult>;
  status(cwd: string): Promise<GraphifyStatus>;
}

type CommandResult =
  | { readonly ok: true; readonly stdout: string; readonly stderr: string }
  | {
      readonly ok: false;
      readonly stdout: string;
      readonly stderr: string;
      readonly message: string;
      readonly missingExecutable: boolean;
    };

type CommandRunner = (
  command: string,
  args: ReadonlyArray<string>,
  opts: { readonly cwd: string },
) => Promise<CommandResult>;

export class GraphifyManager implements GraphifyLifecycle {
  private readonly command: string;
  private readonly runCommand: CommandRunner;
  private readonly stateDir: string | null;
  private readonly inFlight = new Map<string, Promise<GraphifyRunResult>>();

  constructor(opts: {
    readonly command?: string;
    readonly runCommand?: CommandRunner;
    readonly stateDir?: string;
  } = {}) {
    this.command = opts.command ?? "graphify";
    this.runCommand = opts.runCommand ?? runExecFile;
    this.stateDir = opts.stateDir ? resolve(opts.stateDir) : null;
  }

  async status(cwd: string): Promise<GraphifyStatus> {
    const graphPath = graphPathFor(cwd, this.stateDir ?? undefined);
    const legacyPath = legacyGraphPathFor(cwd);
    const readableGraphPath = existsSync(graphPath) ? graphPath : legacyPath;
    if (!existsSync(readableGraphPath)) {
      return {
        graphPath,
        exists: false,
        valid: false,
        nodeCount: null,
        edgeCount: null,
        error: "graphify-out/graph.json does not exist",
      };
    }

    try {
      const raw = await readFile(readableGraphPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      const counts = graphCounts(parsed);
      if (counts.nodeCount === null) {
        return {
          graphPath,
          exists: true,
          valid: false,
          nodeCount: null,
          edgeCount: counts.edgeCount,
          error: "graph.json does not contain a nodes collection",
        };
      }
      return {
        graphPath: readableGraphPath,
        exists: true,
        valid: true,
        nodeCount: counts.nodeCount,
        edgeCount: counts.edgeCount,
      };
    } catch (err) {
      return {
        graphPath,
        exists: true,
        valid: false,
        nodeCount: null,
        edgeCount: null,
        error: (err as Error).message,
      };
    }
  }

  async ensureInitialized(cwd: string): Promise<GraphifyRunResult> {
    return this.exclusive(cwd, async () => {
      const current = await this.status(cwd);
      if (current.valid) {
        return success({
          action: "initialize",
          cwd,
          status: current,
          stdout: "",
          stderr: "",
          skipped: true,
        });
      }

      const result = await this.runCommand(this.command, [".", "--wiki", "--no-viz"], { cwd });
      return this.finishCommand({
        action: "initialize",
        cwd,
        result,
      });
    });
  }

  async update(cwd: string, _reason: GraphifyReason): Promise<GraphifyRunResult> {
    return this.exclusive(cwd, async () => {
      const result = await this.runCommand(this.command, ["update", "."], { cwd });
      return this.finishCommand({
        action: "update",
        cwd,
        result,
      });
    });
  }

  private async exclusive(
    cwd: string,
    run: () => Promise<GraphifyRunResult>,
  ): Promise<GraphifyRunResult> {
    const current = this.inFlight.get(cwd);
    if (current) return current;
    const next = run().finally(() => {
      this.inFlight.delete(cwd);
    });
    this.inFlight.set(cwd, next);
    return next;
  }

  private async finishCommand(args: {
    readonly action: "initialize" | "update";
    readonly cwd: string;
    readonly result: CommandResult;
  }): Promise<GraphifyRunResult> {
    const { action, cwd, result } = args;
    if (!result.ok) {
      return {
        ok: false,
        action,
        cwd,
        code: result.missingExecutable ? "missing_cli" : "command_failed",
        message: result.missingExecutable
          ? `Graphify CLI not found. ${GRAPHIFY_INSTALL_HINT}`
          : result.message,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }

    await persistGraphifyOutputs({
      cwd,
      durableDir: graphDirFor(cwd, this.stateDir ?? undefined),
    });
    const nextStatus = await this.status(cwd);
    if (!nextStatus.valid) {
      return {
        ok: false,
        action,
        cwd,
        code: "invalid_graph",
        message: nextStatus.error ?? "Graphify command completed but graph.json is invalid",
        stdout: result.stdout,
        stderr: result.stderr,
        status: nextStatus,
      };
    }

    return success({
      action,
      cwd,
      status: nextStatus,
      stdout: result.stdout,
      stderr: result.stderr,
      skipped: false,
    });
  }
}

export function graphPathFor(cwd: string, stateDir?: string): string {
  return join(graphDirFor(cwd, stateDir), "graph.json");
}

export function graphDirFor(cwd: string, stateDir?: string): string {
  if (!stateDir) return join(cwd, "graphify-out");
  const scope = graphScopeFor(cwd);
  if (scope.kind === "task") {
    return join(resolve(stateDir), "graphify", "tasks", scope.taskId, "current");
  }
  return join(resolve(stateDir), "graphify", "repo", scope.repoKey, "current");
}

export function legacyGraphPathFor(cwd: string): string {
  return join(cwd, "graphify-out", "graph.json");
}

function graphScopeFor(cwd: string):
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "repo"; readonly repoKey: string } {
  const resolved = resolve(cwd);
  if (basename(dirname(resolved)) === "worktrees") {
    return { kind: "task", taskId: basename(resolved) };
  }
  return { kind: "repo", repoKey: repoKeyFor(resolved) };
}

function repoKeyFor(cwd: string): string {
  return createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 32);
}

async function persistGraphifyOutputs(args: {
  readonly cwd: string;
  readonly durableDir: string;
}): Promise<void> {
  const scratchDir = join(args.cwd, "graphify-out");
  const graphPath = join(scratchDir, "graph.json");
  if (!existsSync(graphPath)) return;
  await mkdir(args.durableDir, { recursive: true });
  await cp(graphPath, join(args.durableDir, "graph.json"));
  for (const name of ["GRAPH_REPORT.md", "wiki"] as const) {
    const src = join(scratchDir, name);
    if (existsSync(src)) {
      await cp(src, join(args.durableDir, name), { recursive: true });
    }
  }
}

async function runExecFile(
  command: string,
  args: ReadonlyArray<string>,
  opts: { readonly cwd: string },
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, [...args], {
      cwd: opts.cwd,
      maxBuffer: 2_000_000,
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (err) {
    const details = errorDetails(err);
    return {
      ok: false,
      stdout: details.stdout,
      stderr: details.stderr,
      message: details.stderr || details.stdout || details.message,
      missingExecutable: details.code === "ENOENT",
    };
  }
}

function success(args: {
  readonly action: "initialize" | "update";
  readonly cwd: string;
  readonly status: GraphifyStatus;
  readonly stdout: string;
  readonly stderr: string;
  readonly skipped: boolean;
}): GraphifyRunResult {
  return {
    ok: true,
    action: args.action,
    cwd: args.cwd,
    status: args.status,
    stdout: args.stdout,
    stderr: args.stderr,
    skipped: args.skipped,
  };
}

function graphCounts(value: unknown): {
  readonly nodeCount: number | null;
  readonly edgeCount: number | null;
} {
  if (!isRecord(value)) return { nodeCount: null, edgeCount: null };
  return {
    nodeCount: collectionSize(value["nodes"]),
    edgeCount: collectionSize(value["edges"]),
  };
}

function collectionSize(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (isRecord(value)) return Object.keys(value).length;
  return null;
}

function errorDetails(err: unknown): {
  readonly code?: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly message: string;
} {
  if (!isRecord(err)) return { stdout: "", stderr: "", message: String(err) };
  return {
    ...(typeof err["code"] === "string" ? { code: err["code"] } : {}),
    stdout: typeof err["stdout"] === "string" ? err["stdout"].trim() : "",
    stderr: typeof err["stderr"] === "string" ? err["stderr"].trim() : "",
    message: typeof err["message"] === "string" ? err["message"] : String(err),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
