import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  DEFAULT_GRAPHIFY_PROVIDER_CONFIG,
  type GraphifyProviderConfig,
} from "@pi-harness/shared";
import type { GraphifyInstallCoordinator } from "./graphify-installer.js";

const execFileAsync = promisify(execFile);

export const GRAPHIFY_INSTALL_HINT =
  `Install Graphify with: uv tool install --force --upgrade "graphifyy[mcp,ollama]" && graphify install --platform codex`;
const GRAPHIFY_UV_FROM_SPEC = "graphifyy[mcp,ollama]";

// Hard ceiling on any graphify subprocess. Extraction is legitimately slow on
// large repos, but a subprocess that waits on an unreachable LLM backend would
// otherwise hang forever — and because ensureInitialized() runs inside the
// brainstorm tick (before the run is created), that hang wedges the task in
// `brainstorming` with no run and no error. Killing the process turns the hang
// into a failure that run-loop's ensureGraphifyReady() swallows, letting
// brainstorm proceed without the graph.
export const GRAPHIFY_COMMAND_TIMEOUT_MS = 10 * 60_000;

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
      readonly code:
        | "missing_cli"
        | "incompatible_cli"
        | "stale_skill"
        | "missing_python_extra"
        | "missing_llm_key"
        | "command_failed"
        | "invalid_graph";
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
  opts: {
    readonly cwd: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly timeoutMs?: number;
  },
) => Promise<CommandResult>;

type GraphifyCommandFailureCode =
  | "missing_cli"
  | "incompatible_cli"
  | "stale_skill"
  | "missing_python_extra"
  | "missing_llm_key"
  | "command_failed";

export class GraphifyManager implements GraphifyLifecycle {
  private readonly command: string;
  private readonly runCommand: CommandRunner;
  private readonly stateDir: string | null;
  private readonly installer: GraphifyInstallCoordinator | undefined;
  private readonly graphify: GraphifyProviderConfig;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly inFlight = new Map<string, Promise<GraphifyRunResult>>();

  constructor(opts: {
    readonly command?: string;
    readonly runCommand?: CommandRunner;
    readonly stateDir?: string;
    readonly installer?: GraphifyInstallCoordinator;
    readonly graphify?: Partial<GraphifyProviderConfig>;
    readonly env?: Readonly<Record<string, string | undefined>>;
  } = {}) {
    this.command = opts.command ?? "graphify";
    this.runCommand = opts.runCommand ?? runExecFile;
    this.stateDir = opts.stateDir ? resolve(opts.stateDir) : null;
    this.installer = opts.installer;
    this.graphify = { ...DEFAULT_GRAPHIFY_PROVIDER_CONFIG, ...(opts.graphify ?? {}) };
    this.env = opts.env ?? process.env;
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

      const credential = this.semanticCredential();
      if (!credential.ok) {
        this.installer?.recordConfigRequired?.({ message: credential.message });
        return graphifyConfigFailure("initialize", cwd, credential.message);
      }
      const result = await this.runGraphify(cwd, semanticExtractArgs(this.graphify), {
        env: graphifySemanticEnv(this.graphify, credential.apiKey),
      });
      return this.finishCommand({
        action: "initialize",
        cwd,
        result,
      });
    });
  }

  async update(cwd: string, _reason: GraphifyReason): Promise<GraphifyRunResult> {
    return this.exclusive(cwd, async () => {
      const result = await this.runGraphify(cwd, ["update", "."]);
      return this.finishCommand({
        action: "update",
        cwd,
        result,
      });
    });
  }

  private async runGraphify(
    cwd: string,
    args: ReadonlyArray<string>,
    opts: { readonly env?: Readonly<Record<string, string | undefined>> } = {},
  ): Promise<CommandResult> {
    if (await this.installer?.hasReadyInstall()) {
      return this.runCommand("uv", ["tool", "run", "--from", GRAPHIFY_UV_FROM_SPEC, "graphify", ...args], {
        cwd,
        ...(opts.env ? { env: opts.env } : {}),
      });
    }
    return this.runCommand(this.command, args, { cwd, ...(opts.env ? { env: opts.env } : {}) });
  }

  private semanticCredential(): { readonly ok: true; readonly apiKey: string } | { readonly ok: false; readonly message: string } {
    const apiKey = this.env[this.graphify.apiKeyEnv]?.trim();
    if (apiKey) return { ok: true, apiKey };
    return {
      ok: false,
      message: `Graphify provider '${this.graphify.provider}' requires ${this.graphify.apiKeyEnv} for semantic extraction.`,
    };
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
      const code = classifyCommandFailure(result);
      if (
        code === "missing_cli" ||
        code === "incompatible_cli" ||
        code === "stale_skill" ||
        code === "missing_python_extra"
      ) {
        this.installer?.triggerInstall({
          reason: code,
          message: installableFailureMessage(code, result),
        });
      }
      return {
        ok: false,
        action,
        cwd,
        code,
        message: installableFailureMessage(code, result),
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

function semanticExtractArgs(graphify: GraphifyProviderConfig): readonly string[] {
  return [
    "extract",
    ".",
    "--backend",
    "ollama",
    "--model",
    graphify.model,
    "--out",
    ".",
  ];
}

function graphifySemanticEnv(
  graphify: GraphifyProviderConfig,
  apiKey: string,
): Readonly<Record<string, string | undefined>> {
  return {
    OLLAMA_API_KEY: apiKey,
    OLLAMA_BASE_URL: graphify.baseUrl,
    OLLAMA_MODEL: graphify.model,
  };
}

function graphifyConfigFailure(
  action: "initialize" | "update",
  cwd: string,
  message: string,
): GraphifyRunResult {
  return {
    ok: false,
    action,
    cwd,
    code: "missing_llm_key",
    message,
    stdout: "",
    stderr: "",
  };
}

function classifyCommandFailure(
  result: Extract<CommandResult, { ok: false }>,
): GraphifyCommandFailureCode {
  if (result.missingExecutable) return "missing_cli";
  const output = `${result.message}\n${result.stdout}\n${result.stderr}`;
  if (isIncompatibleGraphifyOutput(output)) {
    return "incompatible_cli";
  }
  if (isStaleSkillOutput(output)) return "stale_skill";
  if (isMissingPythonExtraOutput(output)) return "missing_python_extra";
  if (isMissingLlmKeyOutput(output)) return "missing_llm_key";
  return "command_failed";
}

function installableFailureMessage(
  code: GraphifyCommandFailureCode,
  result: Extract<CommandResult, { ok: false }>,
): string {
  if (code === "missing_cli") return `Graphify CLI not found. ${GRAPHIFY_INSTALL_HINT}`;
  if (code === "incompatible_cli") {
    return `Graphify CLI is incompatible with this workflow. ${GRAPHIFY_INSTALL_HINT}`;
  }
  if (code === "stale_skill") {
    return `Graphify skill files are stale. ${GRAPHIFY_INSTALL_HINT}`;
  }
  if (code === "missing_python_extra") {
    return `Graphify is missing the Python dependencies for semantic extraction. ${GRAPHIFY_INSTALL_HINT}`;
  }
  if (code === "missing_llm_key") {
    return "Graphify needs an LLM backend for headless extraction. Set the configured Graphify API key env var, configure Ollama, or pass a supported backend.";
  }
  return result.message;
}

function isIncompatibleGraphifyOutput(output: string): boolean {
  return output.includes("unknown command '.'") || output.includes('unknown command "."');
}

function isStaleSkillOutput(output: string): boolean {
  return output.includes("skill is from graphify") && output.includes("Run 'graphify install' to update");
}

function isMissingPythonExtraOutput(output: string): boolean {
  return output.includes("requires the openai package") ||
    (output.includes("requires the") && output.includes("package") && output.includes("pip install"));
}

function isMissingLlmKeyOutput(output: string): boolean {
  return output.includes("no LLM API key found");
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

export async function runExecFile(
  command: string,
  args: ReadonlyArray<string>,
  opts: {
    readonly cwd: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly timeoutMs?: number;
  },
): Promise<CommandResult> {
  try {
    // `timeout` makes execFile send `killSignal` (default SIGTERM) once the
    // limit is hit and reject the promise — so a hung graphify subprocess can
    // never block the caller past this ceiling.
    const result = await execFileAsync(command, [...args], {
      cwd: opts.cwd,
      ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
      maxBuffer: 2_000_000,
      timeout: opts.timeoutMs ?? GRAPHIFY_COMMAND_TIMEOUT_MS,
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
