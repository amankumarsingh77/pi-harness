import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ContainerRuntimeSchema,
  HarnessProjectConfigSchema,
  WebProviderSchema,
  type HarnessProjectConfig,
  type HarnessProjectConfigInput,
  mergeHarnessProjectConfig,
  parseHarnessProjectEnv,
} from "@pi-harness/shared";
import type { ExecFile } from "./exec.js";

export type LoadConfigResult =
  | { readonly ok: true; readonly config: HarnessProjectConfig }
  | { readonly ok: false; readonly error: "not_git_repo" | "missing_config" | "invalid_config"; readonly message: string };

export async function loadProjectConfig(opts: {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly execFile: ExecFile;
}): Promise<LoadConfigResult> {
  const root = await detectGitRoot(opts.cwd, opts.execFile);
  if (!root) {
    return { ok: false, error: "not_git_repo", message: "pi-harness must run inside a git repository." };
  }
  const configPath = join(root, "harness.config.ts");
  if (!existsSync(configPath)) {
    return { ok: false, error: "missing_config", message: "Missing harness.config.ts. Run pi-harness init first." };
  }
  const fileConfig = parseConfigSource(await readFile(configPath, "utf8"));
  if (!fileConfig) {
    return { ok: false, error: "invalid_config", message: "Unable to parse harness.config.ts." };
  }
  const envConfig = parseHarnessProjectEnv(opts.env);
  return {
    ok: true,
    config: mergeHarnessProjectConfig({
      ...fileConfig,
      repoRoot: fileConfig.repoRoot ?? root,
      ...envConfig,
    }),
  };
}

export async function detectGitRoot(cwd: string, execFile: ExecFile): Promise<string | null> {
  const result = await execFile("git", ["rev-parse", "--show-toplevel"], { cwd });
  return result.ok ? result.stdout.trim() : null;
}

function parseConfigSource(source: string): Partial<HarnessProjectConfigInput> | null {
  const body = extractConfigObjectBody(source);
  if (!body) return null;
  const value = evaluateConfigBody(body);
  const parsed = HarnessProjectConfigSchema.partial().safeParse(value);
  if (!parsed.success) return null;
  return compactConfigInput(parsed.data);
}

function compactConfigInput(input: Readonly<Record<string, unknown>>): Partial<HarnessProjectConfigInput> {
  const containerRuntime = ContainerRuntimeSchema.safeParse(input["containerRuntime"]);
  const webProvider = WebProviderSchema.safeParse(input["webProvider"]);
  return {
    ...(typeof input["repoRoot"] === "string" ? { repoRoot: input["repoRoot"] } : {}),
    ...(typeof input["baseBranch"] === "string" ? { baseBranch: input["baseBranch"] } : {}),
    ...(typeof input["stateDir"] === "string" ? { stateDir: input["stateDir"] } : {}),
    ...(typeof input["worktreesDir"] === "string" ? { worktreesDir: input["worktreesDir"] } : {}),
    ...(containerRuntime.success ? { containerRuntime: containerRuntime.data } : {}),
    ...(typeof input["dashboardPort"] === "number" ? { dashboardPort: input["dashboardPort"] } : {}),
    ...(typeof input["orchestratorPort"] === "number" ? { orchestratorPort: input["orchestratorPort"] } : {}),
    ...(webProvider.success ? { webProvider: webProvider.data } : {}),
  };
}

function extractConfigObjectBody(source: string): string | null {
  return extractDefaultObjectBody(source) ?? extractDefineCallBody(source);
}

function extractDefaultObjectBody(source: string): string | null {
  const match = /export\s+default\s+({[\s\S]*?});?\s*$/.exec(source.trim());
  return match?.[1] ?? null;
}

function extractDefineCallBody(source: string): string | null {
  const callStart = source.indexOf("defineHarnessConfig(");
  if (callStart === -1) return null;
  const bodyStart = callStart + "defineHarnessConfig(".length;
  const bodyEnd = source.lastIndexOf(");");
  if (bodyEnd <= bodyStart) return null;
  return source.slice(bodyStart, bodyEnd);
}

function evaluateConfigBody(body: string): unknown {
  const fn = new Function("defineHarnessConfig", `return defineHarnessConfig(${body});`);
  return fn((value: unknown) => value);
}
