import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  GraphifyInstallReason,
  GraphifyInstallState,
  GraphifyInstallStatus,
} from "@pi-harness/shared";
import { appendJsonl, readJsonl } from "../adapters/jsonl-writer.js";
import type { LiveEventStore } from "../adapters/live-event-store.js";

const execFileAsync = promisify(execFile);
const OUTPUT_TAIL_LIMIT = 4000;
const GRAPHIFY_PACKAGE_SPEC = "graphifyy[mcp,ollama]";
const GRAPHIFY_INSTALL_ARGS = ["tool", "install", "--force", "--upgrade", GRAPHIFY_PACKAGE_SPEC] as const;
const GRAPHIFY_SKILL_INSTALL_ARGS = [
  "tool",
  "run",
  "--from",
  GRAPHIFY_PACKAGE_SPEC,
  "graphify",
  "install",
  "--platform",
  "codex",
] as const;

type InstallCommandResult =
  | { readonly ok: true; readonly stdout: string; readonly stderr: string }
  | {
      readonly ok: false;
      readonly stdout: string;
      readonly stderr: string;
      readonly message: string;
    };

type InstallCommandRunner = (
  command: string,
  args: ReadonlyArray<string>,
  opts: { readonly cwd?: string },
) => Promise<InstallCommandResult>;

export interface GraphifyInstallCoordinator {
  hasReadyInstall(): Promise<boolean>;
  recordConfigRequired?(input: {
    readonly message: string;
  }): void;
  triggerInstall(input: {
    readonly reason: GraphifyInstallReason;
    readonly message: string;
  }): void;
}

export class GraphifyInstallStore {
  private readonly logPath: string;

  constructor(opts: { readonly stateDir: string }) {
    this.logPath = join(resolve(opts.stateDir), "store", "graphify-install.jsonl");
  }

  async latest(): Promise<GraphifyInstallState | null> {
    const records = await readJsonl<unknown>(this.logPath);
    let latest: GraphifyInstallState | null = null;
    for (const record of records) {
      const parsed = parseInstallState(record);
      if (parsed) latest = parsed;
    }
    return latest;
  }

  async append(state: GraphifyInstallState): Promise<GraphifyInstallState> {
    await appendJsonl(this.logPath, serializeInstallState(state));
    return state;
  }
}

export class GraphifyAutoInstaller implements GraphifyInstallCoordinator {
  private readonly store: GraphifyInstallStore;
  private readonly liveEvents: LiveEventStore | undefined;
  private readonly runCommand: InstallCommandRunner;
  private readonly cwd: string | undefined;
  private inFlight: Promise<GraphifyInstallState> | null = null;

  constructor(opts: {
    readonly stateDir: string;
    readonly liveEvents?: LiveEventStore;
    readonly cwd?: string;
    readonly runCommand?: InstallCommandRunner;
  }) {
    this.store = new GraphifyInstallStore({ stateDir: opts.stateDir });
    this.liveEvents = opts.liveEvents;
    this.cwd = opts.cwd;
    this.runCommand = opts.runCommand ?? runExecFile;
  }

  async status(): Promise<GraphifyInstallState | null> {
    return this.store.latest();
  }

  async hasReadyInstall(): Promise<boolean> {
    return (await this.status())?.status === "ready";
  }

  triggerInstall(input: {
    readonly reason: GraphifyInstallReason;
    readonly message: string;
  }): void {
    void this.installNow(input).catch(() => {
      // installNow records failures as state; this catch only prevents a
      // background promise from becoming an unhandled rejection.
    });
  }

  recordConfigRequired(input: { readonly message: string }): void {
    void this.record({
      status: "config_required",
      reason: "missing_provider_key",
      message: input.message,
      updatedAt: new Date(),
    });
  }

  installNow(input: {
    readonly reason: GraphifyInstallReason;
    readonly message: string;
  }): Promise<GraphifyInstallState> {
    if (this.inFlight) return this.inFlight;
    const next = this.runInstall(input).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = next;
    return next;
  }

  private async runInstall(input: {
    readonly reason: GraphifyInstallReason;
    readonly message: string;
  }): Promise<GraphifyInstallState> {
    await this.record({
      status: "installing",
      reason: input.reason,
      message: input.message,
      updatedAt: new Date(),
    });

    const packageResult = await this.runCommand("uv", GRAPHIFY_INSTALL_ARGS, cwdOpt(this.cwd));
    if (!packageResult.ok) {
      return this.recordFailure(input.reason, packageResult);
    }

    const skillResult = await this.runCommand("uv", GRAPHIFY_SKILL_INSTALL_ARGS, cwdOpt(this.cwd));
    if (!skillResult.ok) {
      return this.recordFailure(input.reason, {
        ok: false,
        message: skillResult.message,
        stdout: joinOutput(packageResult.stdout, skillResult.stdout),
        stderr: joinOutput(packageResult.stderr, skillResult.stderr),
      });
    }

    return this.record({
      status: "ready",
      updatedAt: new Date(),
      stdoutTail: tail(joinOutput(packageResult.stdout, skillResult.stdout)),
      stderrTail: tail(joinOutput(packageResult.stderr, skillResult.stderr)),
    });
  }

  private recordFailure(
    reason: GraphifyInstallReason,
    result: Extract<InstallCommandResult, { ok: false }>,
  ): Promise<GraphifyInstallState> {
    return this.record({
      status: "install_failed",
      reason,
      message: result.message,
      updatedAt: new Date(),
      stdoutTail: tail(result.stdout),
      stderrTail: tail(result.stderr),
    });
  }

  private async record(state: GraphifyInstallState): Promise<GraphifyInstallState> {
    const saved = await this.store.append(state);
    await this.liveEvents?.publishGraphifyStatus(saved);
    return saved;
  }
}

function serializeInstallState(state: GraphifyInstallState): Record<string, unknown> {
  return {
    ...state,
    updatedAt: state.updatedAt.toISOString(),
  };
}

function parseInstallState(value: unknown): GraphifyInstallState | null {
  if (!isRecord(value)) return null;
  const status = parseStatus(value["status"]);
  const updatedAt = parseDate(value["updatedAt"]);
  if (!status || !updatedAt) return null;
  const reason = parseReason(value["reason"]);
  return {
    status,
    updatedAt,
    ...(reason ? { reason } : {}),
    ...(typeof value["message"] === "string" ? { message: value["message"] } : {}),
    ...(typeof value["stdoutTail"] === "string" ? { stdoutTail: value["stdoutTail"] } : {}),
    ...(typeof value["stderrTail"] === "string" ? { stderrTail: value["stderrTail"] } : {}),
  };
}

function parseStatus(value: unknown): GraphifyInstallStatus | null {
  return value === "ready" ||
    value === "installing" ||
    value === "install_failed" ||
    value === "config_required"
    ? value
    : null;
}

function parseReason(value: unknown): GraphifyInstallReason | null {
  return value === "missing_cli" ||
    value === "incompatible_cli" ||
    value === "stale_skill" ||
    value === "missing_python_extra" ||
    value === "missing_provider_key"
    ? value
    : null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function tail(value: string): string {
  return value.length > OUTPUT_TAIL_LIMIT ? value.slice(-OUTPUT_TAIL_LIMIT) : value;
}

function joinOutput(first: string, second: string): string {
  return [first, second].filter((value) => value.length > 0).join("\n");
}

function cwdOpt(cwd: string | undefined): { readonly cwd?: string } {
  return cwd ? { cwd } : {};
}

async function runExecFile(
  command: string,
  args: ReadonlyArray<string>,
  opts: { readonly cwd?: string },
): Promise<InstallCommandResult> {
  try {
    const result = await execFileAsync(command, [...args], {
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
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
    };
  }
}

function errorDetails(err: unknown): {
  readonly stdout: string;
  readonly stderr: string;
  readonly message: string;
} {
  if (!isRecord(err)) return { stdout: "", stderr: "", message: String(err) };
  return {
    stdout: typeof err["stdout"] === "string" ? err["stdout"].trim() : "",
    stderr: typeof err["stderr"] === "string" ? err["stderr"].trim() : "",
    message: typeof err["message"] === "string" ? err["message"] : String(err),
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
