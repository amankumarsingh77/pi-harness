import { execFile } from "node:child_process";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { GraphifyConfig } from "../config.js";

const execFileAsync = promisify(execFile);

const GRAPHIFY_PACKAGE = "graphifyy[mcp,svg,sql,terraform,office,pdf]";
const MAX_CLI_OUTPUT_CHARS = 12_000;
const MAX_JSON_ARTIFACT_BYTES = 20 * 1024 * 1024;

export type GraphifyJobStatus = "idle" | "running" | "failed";
export type GraphifyAction = "bootstrap" | "initial-build" | "update" | "rebuild" | "export";
export type GraphifyArtifactKind = "report" | "html" | "callflow" | "tree" | "json";

export type GraphifyStatus = {
  readonly enabled: boolean;
  readonly bootstrap: boolean;
  readonly installed: boolean;
  readonly version: string | null;
  readonly minVersion: string;
  readonly graphExists: boolean;
  readonly reportExists: boolean;
  readonly htmlExists: boolean;
  readonly callflowExists: boolean;
  readonly treeExists: boolean;
  readonly jsonBytes: number | null;
  readonly job: {
    readonly status: GraphifyJobStatus;
    readonly action: GraphifyAction | null;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
    readonly error: string | null;
  };
};

export type GraphifyCliResult = {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly command: string;
  readonly args: readonly string[];
};

export type GraphifyArtifact = {
  readonly kind: GraphifyArtifactKind;
  readonly path: string;
  readonly contentType: string;
  readonly bytes: number;
  readonly body: Buffer;
};

export interface GraphifyService {
  getStatus(): Promise<GraphifyStatus>;
  bootstrap(): Promise<GraphifyStatus>;
  startAction(action: Exclude<GraphifyAction, "bootstrap" | "initial-build">): Promise<GraphifyStatus>;
  readArtifact(kind: GraphifyArtifactKind): Promise<GraphifyArtifact | null>;
  runQuery(args: readonly string[], signal?: AbortSignal): Promise<GraphifyCliResult>;
}

export type GraphifyServiceDeps = {
  readonly cwd: string;
  readonly config: GraphifyConfig;
  readonly run?: CliRunner;
  readonly now?: () => Date;
};

type CliRunner = (input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly signal?: AbortSignal;
}) => Promise<{ readonly stdout: string; readonly stderr: string }>;

type JobState = {
  readonly status: GraphifyJobStatus;
  readonly action: GraphifyAction | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly error: string | null;
};

const IDLE_JOB: JobState = {
  status: "idle",
  action: null,
  startedAt: null,
  completedAt: null,
  error: null,
};

export function createGraphifyService(deps: GraphifyServiceDeps): GraphifyService {
  let job: JobState = IDLE_JOB;
  let activeJob: Promise<void> | null = null;
  const run = deps.run ?? defaultCliRunner;

  const graphifyOut = join(deps.cwd, "graphify-out");

  const runGraphify = (
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<GraphifyCliResult> =>
    runCommand({
      run,
      cwd: deps.cwd,
      command: deps.config.bin,
      args,
      ...(signal !== undefined ? { signal } : {}),
    });

  const runJob = (action: GraphifyAction, task: () => Promise<void>): Promise<void> => {
    if (activeJob !== null) return activeJob;
    job = {
      status: "running",
      action,
      startedAt: deps.now?.().toISOString() ?? new Date().toISOString(),
      completedAt: null,
      error: null,
    };
    activeJob = task()
      .then(() => {
        job = {
          status: "idle",
          action,
          startedAt: job.startedAt,
          completedAt: deps.now?.().toISOString() ?? new Date().toISOString(),
          error: null,
        };
      })
      .catch((err: unknown) => {
        job = {
          status: "failed",
          action,
          startedAt: job.startedAt,
          completedAt: deps.now?.().toISOString() ?? new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        };
      })
      .finally(() => {
        activeJob = null;
      });
    return activeJob;
  };

  return {
    async getStatus() {
      return buildStatus({
        cwd: deps.cwd,
        graphifyOut,
        config: deps.config,
        job,
        runGraphify,
      });
    },

    async bootstrap() {
      if (!deps.config.enabled || !deps.config.bootstrap) return this.getStatus();
      await mkdir(graphifyOut, { recursive: true });
      await runJob("bootstrap", async () => {
        await ensureInstalled({
          config: deps.config,
          run,
          cwd: deps.cwd,
          runGraphify,
        });
        await runGraphify(["install", "--project", "--platform", "pi"]);
      });
      if (job.status === "failed") return this.getStatus();
      const graphExists = await pathExists(join(graphifyOut, "graph.json"));
      if (!graphExists) {
        const initialBuild = runJob("initial-build", async () => {
          await runGraphify(["extract", ".", "--out", "."]);
          await runGraphify(["cluster-only", "."]);
        });
        if (deps.config.bootBlock) await initialBuild;
      }
      return this.getStatus();
    },

    async startAction(action) {
      if (!deps.config.enabled) return this.getStatus();
      void runJob(action, () => runAction(action, runGraphify));
      return this.getStatus();
    },

    async readArtifact(kind) {
      const path = await findArtifactPath(graphifyOut, kind);
      if (path === null) return null;
      const info = await stat(path);
      if (kind === "json" && info.size > MAX_JSON_ARTIFACT_BYTES) {
        return null;
      }
      return {
        kind,
        path,
        contentType: contentTypeFor(kind),
        bytes: info.size,
        body: await readFile(path),
      };
    },

    async runQuery(args, signal) {
      return runGraphify(args, signal);
    },
  };
}

async function runAction(
  action: Exclude<GraphifyAction, "bootstrap" | "initial-build">,
  runGraphify: (args: readonly string[], signal?: AbortSignal) => Promise<GraphifyCliResult>,
): Promise<void> {
  if (action === "update") {
    await runGraphify(["update", ".", "--force"]);
    return;
  }
  if (action === "rebuild") {
    await runGraphify(["extract", ".", "--out", "."]);
    await runGraphify(["cluster-only", "."]);
    return;
  }
  await runGraphify(["export", "html", "."]);
  await runGraphify(["export", "callflow-html", "."]);
  await runGraphify(["tree", "."]);
}

async function ensureInstalled(args: {
  readonly config: GraphifyConfig;
  readonly run: CliRunner;
  readonly cwd: string;
  readonly runGraphify: (graphifyArgs: readonly string[]) => Promise<GraphifyCliResult>;
}): Promise<void> {
  const versionResult = await args.runGraphify(["--version"]);
  const version = parseGraphifyVersion(versionResult.stdout || versionResult.stderr);
  if (versionResult.ok && version !== null && compareVersions(version, args.config.minVersion) >= 0) {
    return;
  }
  const result = await runCommand({
    run: args.run,
    cwd: args.cwd,
    command: "uv",
    args: ["tool", "install", "--upgrade", GRAPHIFY_PACKAGE],
  });
  if (!result.ok) {
    throw new Error(`Graphify install failed: ${result.stderr || result.stdout}`);
  }
}

async function buildStatus(args: {
  readonly cwd: string;
  readonly graphifyOut: string;
  readonly config: GraphifyConfig;
  readonly job: JobState;
  readonly runGraphify: (graphifyArgs: readonly string[]) => Promise<GraphifyCliResult>;
}): Promise<GraphifyStatus> {
  const versionResult = args.config.enabled
    ? await args.runGraphify(["--version"])
    : null;
  const version = versionResult?.ok
    ? parseGraphifyVersion(versionResult.stdout || versionResult.stderr)
    : null;
  const jsonPath = join(args.graphifyOut, "graph.json");
  const jsonStat = await stat(jsonPath).catch(() => null);
  return {
    enabled: args.config.enabled,
    bootstrap: args.config.bootstrap,
    installed: versionResult?.ok ?? false,
    version,
    minVersion: args.config.minVersion,
    graphExists: jsonStat !== null,
    reportExists: (await findArtifactPath(args.graphifyOut, "report")) !== null,
    htmlExists: (await findArtifactPath(args.graphifyOut, "html")) !== null,
    callflowExists: (await findArtifactPath(args.graphifyOut, "callflow")) !== null,
    treeExists: (await findArtifactPath(args.graphifyOut, "tree")) !== null,
    jsonBytes: jsonStat?.size ?? null,
    job: args.job,
  };
}

async function runCommand(args: {
  readonly run: CliRunner;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly signal?: AbortSignal;
}): Promise<GraphifyCliResult> {
  try {
    const result = await args.run({
      command: args.command,
      args: args.args,
      cwd: args.cwd,
      ...(args.signal !== undefined ? { signal: args.signal } : {}),
    });
    return {
      ok: true,
      stdout: boundOutput(result.stdout),
      stderr: boundOutput(result.stderr),
      command: args.command,
      args: args.args,
    };
  } catch (err) {
    const output = extractExecOutput(err);
    return {
      ok: false,
      stdout: boundOutput(output.stdout),
      stderr: boundOutput(output.stderr || output.message),
      command: args.command,
      args: args.args,
    };
  }
}

async function defaultCliRunner(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly signal?: AbortSignal;
}): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const result = await execFileAsync(input.command, [...input.args], {
    cwd: input.cwd,
    maxBuffer: 1_000_000,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function findArtifactPath(
  graphifyOut: string,
  kind: GraphifyArtifactKind,
): Promise<string | null> {
  const candidates: Record<GraphifyArtifactKind, readonly string[]> = {
    report: ["GRAPH_REPORT.md", "graph-report.md", "report.md"],
    html: ["graph.html", "index.html"],
    callflow: ["callflow.html", "call-flow.html", "callflow/index.html"],
    tree: ["GRAPH_TREE.html", "tree.html", "tree/index.html"],
    json: ["graph.json"],
  };
  for (const relative of candidates[kind]) {
    const absolute = join(graphifyOut, relative);
    if (await pathExists(absolute)) return absolute;
  }
  return null;
}

function contentTypeFor(kind: GraphifyArtifactKind): string {
  if (kind === "report") return "text/markdown; charset=utf-8";
  if (kind === "json") return "application/json; charset=utf-8";
  return "text/html; charset=utf-8";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseGraphifyVersion(output: string): string | null {
  const match = /graphify\s+(\d+\.\d+\.\d+)/i.exec(output.trim());
  return match?.[1] ?? null;
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  for (const index of [0, 1, 2]) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function parseVersionParts(version: string): readonly number[] {
  return version.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

function boundOutput(output: string): string {
  if (output.length <= MAX_CLI_OUTPUT_CHARS) return output;
  return `${output.slice(0, MAX_CLI_OUTPUT_CHARS)}\n[truncated]\n`;
}

function extractExecOutput(err: unknown): {
  readonly stdout: string;
  readonly stderr: string;
  readonly message: string;
} {
  if (typeof err === "object" && err !== null) {
    return {
      stdout: stringProperty(err, "stdout"),
      stderr: stringProperty(err, "stderr"),
      message: stringProperty(err, "message") || String(err),
    };
  }
  return { stdout: "", stderr: "", message: String(err) };
}

function stringProperty(value: object, key: string): string {
  const property = Reflect.get(value, key);
  return typeof property === "string" ? property : "";
}
