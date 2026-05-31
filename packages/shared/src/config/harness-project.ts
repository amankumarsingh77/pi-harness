import { z } from "zod";

export const ContainerRuntimeSchema = z.enum(["podman", "docker"]);
export type ContainerRuntime = z.infer<typeof ContainerRuntimeSchema>;

export const WebProviderSchema = z.enum(["tinyfish", "searxng"]);
export type WebProvider = z.infer<typeof WebProviderSchema>;

export const HarnessProjectConfigSchema = z.object({
  repoRoot: z.string().min(1),
  baseBranch: z.string().min(1),
  stateDir: z.string().min(1),
  worktreesDir: z.string().min(1),
  containerRuntime: ContainerRuntimeSchema,
  dashboardPort: z.number().int().min(1).max(65535),
  orchestratorPort: z.number().int().min(1).max(65535),
  webProvider: WebProviderSchema,
});
export type HarnessProjectConfig = z.infer<typeof HarnessProjectConfigSchema>;

export type HarnessProjectConfigInput = {
  readonly repoRoot: string;
  readonly baseBranch?: string;
  readonly stateDir?: string;
  readonly worktreesDir?: string;
  readonly containerRuntime?: ContainerRuntime;
  readonly dashboardPort?: number;
  readonly orchestratorPort?: number;
  readonly webProvider?: WebProvider;
};

export const DEFAULT_HARNESS_PROJECT_CONFIG: HarnessProjectConfig = {
  repoRoot: ".",
  baseBranch: "main",
  stateDir: ".harness",
  worktreesDir: ".harness/worktrees",
  containerRuntime: "podman",
  dashboardPort: 3000,
  orchestratorPort: 4000,
  webProvider: "tinyfish",
};

export function defineHarnessConfig(config: HarnessProjectConfigInput): HarnessProjectConfigInput {
  return config;
}

export function mergeHarnessProjectConfig(config: HarnessProjectConfigInput): HarnessProjectConfig {
  const stateDir = config.stateDir ?? pathInProject(config.repoRoot, ".harness");
  const worktreesDir = config.worktreesDir ?? pathInProject(stateDir, "worktrees");
  return HarnessProjectConfigSchema.parse({
    ...DEFAULT_HARNESS_PROJECT_CONFIG,
    ...config,
    stateDir,
    worktreesDir,
  });
}

export function parseHarnessProjectEnv(
  env: Readonly<Record<string, string | undefined>>,
): Partial<HarnessProjectConfigInput> {
  return {
    ...(env["HARNESS_REPO_ROOT"] ? { repoRoot: env["HARNESS_REPO_ROOT"] } : {}),
    ...(env["HARNESS_BASE_BRANCH"] ? { baseBranch: env["HARNESS_BASE_BRANCH"] } : {}),
    ...(env["HARNESS_STATE_DIR"] ? { stateDir: env["HARNESS_STATE_DIR"] } : {}),
    ...(env["HARNESS_WORKTREES_DIR"] ? { worktreesDir: env["HARNESS_WORKTREES_DIR"] } : {}),
    ...(parseContainerRuntime(env["HARNESS_CONTAINER_RUNTIME"])),
    ...(parsePort("dashboardPort", env["DASHBOARD_PORT"])),
    ...(parsePort("orchestratorPort", env["ORCHESTRATOR_PORT"] ?? env["PORT"])),
    ...(parseWebProvider(env["PI_WEB_PROVIDER"])),
  };
}

function pathInProject(root: string, child: string): string {
  const trimmedRoot = root.endsWith("/") ? root.slice(0, -1) : root;
  const trimmedChild = child.startsWith("/") ? child.slice(1) : child;
  return `${trimmedRoot}/${trimmedChild}`;
}

function parsePort(
  key: "dashboardPort" | "orchestratorPort",
  raw: string | undefined,
): Partial<Pick<HarnessProjectConfigInput, "dashboardPort" | "orchestratorPort">> {
  if (!raw) return {};
  const value = Number(raw);
  if (!Number.isInteger(value)) return {};
  if (value < 1 || value > 65535) return {};
  return { [key]: value };
}

function parseContainerRuntime(
  raw: string | undefined,
): Partial<Pick<HarnessProjectConfigInput, "containerRuntime">> {
  const parsed = ContainerRuntimeSchema.safeParse(raw);
  return parsed.success ? { containerRuntime: parsed.data } : {};
}

function parseWebProvider(
  raw: string | undefined,
): Partial<Pick<HarnessProjectConfigInput, "webProvider">> {
  const parsed = WebProviderSchema.safeParse(raw);
  return parsed.success ? { webProvider: parsed.data } : {};
}
