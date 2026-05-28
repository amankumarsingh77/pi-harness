import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { HarnessProjectConfig } from "@pi-harness/shared";
import { runDoctor } from "./doctor.js";
import type { ExecFile } from "./exec.js";

export type DevResult =
  | { readonly ok: true; readonly mode: "check-only"; readonly dashboardUrl: string }
  | { readonly ok: false; readonly message: string };

export async function runDev(opts: {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly execFile: ExecFile;
  readonly checkOnly: boolean;
}): Promise<DevResult> {
  const doctor = await runDoctor(opts);
  if (!doctor.ok || !doctor.config) {
    return { ok: false, message: "pi-harness doctor failed. Run pi-harness doctor for details." };
  }
  const dashboardUrl = `http://localhost:${doctor.config.dashboardPort}`;
  if (opts.checkOnly) return { ok: true, mode: "check-only", dashboardUrl };

  const infra = await startInfra({ config: doctor.config, execFile: opts.execFile });
  if (!infra.ok) return infra;
  startServices({ config: doctor.config, env: opts.env });
  return new Promise(() => undefined);
}

async function startInfra(opts: {
  readonly config: HarnessProjectConfig;
  readonly execFile: ExecFile;
}): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  if (opts.config.webProvider !== "searxng") return { ok: true };
  const composeFile = join(opts.config.stateDir, "runtime", "compose.yml");
  const up = await opts.execFile(opts.config.containerRuntime, [
    "compose",
    "-f",
    composeFile,
    "up",
    "-d",
    "searxng",
  ]);
  if (!up.ok) return { ok: false, message: up.stderr };
  return { ok: true };
}

function startServices(opts: {
  readonly config: HarnessProjectConfig;
  readonly env: NodeJS.ProcessEnv;
}): void {
  const runtimePromise = Promise.all([
    findPackageRoot("@pi-harness/orchestrator"),
    findPackageRoot("@pi-harness/dashboard"),
  ]);
  runtimePromise.then(([orchestratorRoot, dashboardRoot]) => {
    const env = serviceEnv(opts.config, opts.env);
    const nextBin = resolvePackageBinFrom(dashboardRoot, "next");
    const orchestrator = spawn(process.execPath, [join(orchestratorRoot, "dist", "index.js")], {
      stdio: "inherit",
      env,
    });
    const dashboard = spawn(process.execPath, [nextBin, "dev", "-p", String(opts.config.dashboardPort)], {
      cwd: dashboardRoot,
      stdio: "inherit",
      env,
    });
    const stop = (): void => {
      orchestrator.kill("SIGINT");
      dashboard.kill("SIGINT");
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    console.log(`Dashboard: http://localhost:${opts.config.dashboardPort}`);
    console.log(`Worktrees: ${opts.config.worktreesDir}`);
  });
}

function serviceEnv(config: HarnessProjectConfig, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    HARNESS_REPO_ROOT: config.repoRoot,
    HARNESS_BASE_BRANCH: config.baseBranch,
    HARNESS_STATE_DIR: config.stateDir,
    HARNESS_WORKTREES_DIR: config.worktreesDir,
    ORCHESTRATOR_URL: `http://localhost:${config.orchestratorPort}`,
    PORT: String(config.orchestratorPort),
    DASHBOARD_PORT: String(config.dashboardPort),
    PI_WEB_PROVIDER: config.webProvider,
    GRAPHIFY_PROVIDER: config.graphify.provider,
    GRAPHIFY_MODEL: config.graphify.model,
    GRAPHIFY_BASE_URL: config.graphify.baseUrl,
    GRAPHIFY_API_KEY_ENV: config.graphify.apiKeyEnv,
  };
}

async function findPackageRoot(packageName: string): Promise<string> {
  const require = createRequire(import.meta.url);
  const resolved = resolvePackageEntry(require, packageName) || fallbackWorkspacePackagePath(packageName);
  let current = dirname(resolved);
  for (const _ of Array.from({ length: 8 })) {
    const pkg = join(current, "package.json");
    if (existsSync(pkg)) {
      const parsed = JSON.parse(await readFile(pkg, "utf8"));
      if (isPackage(parsed, packageName)) return current;
    }
    current = dirname(current);
  }
  throw new Error(`Unable to locate ${packageName}.`);
}

function resolvePackageBinFrom(root: string, packageName: string): string {
  const require = createRequire(join(root, "package.json"));
  const resolved = resolvePackageEntry(require, packageName);
  if (!resolved) throw new Error(`Unable to locate ${packageName}.`);
  return packageBinFromPackageRoot(dirname(resolved), packageName);
}

function packageBinFromPackageRoot(root: string, packageName: string): string {
  const pkg = join(root, "package.json");
  const parsed = JSON.parse(readFileSyncUtf8(pkg));
  const bin = readPackageBin(parsed, packageName);
  if (!bin) throw new Error(`Unable to locate ${packageName} bin.`);
  return join(root, bin);
}

function readFileSyncUtf8(path: string): string {
  return readFileSync(path, "utf8");
}

function readPackageBin(value: unknown, packageName: string): string | null {
  if (typeof value !== "object" || value === null || !("bin" in value)) return null;
  const bin = value.bin;
  if (typeof bin === "string") return bin;
  if (typeof bin !== "object" || bin === null) return null;
  const key = packageName.split("/").at(-1) ?? packageName;
  const candidate = Object.entries(bin).find(([name]) => name === key)?.[1];
  return typeof candidate === "string" ? candidate : null;
}

function resolvePackageEntry(require: NodeJS.Require, packageName: string): string {
  try {
    return require.resolve(`${packageName}/package.json`);
  } catch {
    try {
      return require.resolve(packageName);
    } catch {
      return "";
    }
  }
}

function fallbackWorkspacePackagePath(packageName: string): string {
  if (packageName === "@pi-harness/dashboard") return join(process.cwd(), "apps", "dashboard", "package.json");
  if (packageName === "@pi-harness/orchestrator") return join(process.cwd(), "apps", "orchestrator", "package.json");
  return "";
}

function isPackage(value: unknown, packageName: string): boolean {
  return typeof value === "object" && value !== null && "name" in value && value.name === packageName;
}
