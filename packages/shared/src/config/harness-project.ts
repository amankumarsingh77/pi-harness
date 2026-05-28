import { z } from "zod";

export const ContainerRuntimeSchema = z.enum(["podman", "docker"]);
export type ContainerRuntime = z.infer<typeof ContainerRuntimeSchema>;

export const WebProviderSchema = z.enum(["tinyfish", "searxng"]);
export type WebProvider = z.infer<typeof WebProviderSchema>;

export const GraphifyProviderConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().url(),
  apiKeyEnv: z.string().min(1),
});
export type GraphifyProviderConfig = z.infer<typeof GraphifyProviderConfigSchema>;

export const HarnessProjectConfigSchema = z.object({
  repoRoot: z.string().min(1),
  baseBranch: z.string().min(1),
  stateDir: z.string().min(1),
  worktreesDir: z.string().min(1),
  containerRuntime: ContainerRuntimeSchema,
  dashboardPort: z.number().int().min(1).max(65535),
  orchestratorPort: z.number().int().min(1).max(65535),
  webProvider: WebProviderSchema,
  graphify: GraphifyProviderConfigSchema,
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
  readonly graphify?: Partial<GraphifyProviderConfig>;
};

export const DEFAULT_GRAPHIFY_PROVIDER_CONFIG: GraphifyProviderConfig = {
  provider: "crofai",
  model: "deepseek-v4-pro",
  baseUrl: "https://crof.ai/v1",
  apiKeyEnv: "CROFAI_API_KEY",
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
  graphify: DEFAULT_GRAPHIFY_PROVIDER_CONFIG,
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
    graphify: {
      ...DEFAULT_GRAPHIFY_PROVIDER_CONFIG,
      ...(config.graphify ?? {}),
    },
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
    ...(parseGraphifyProvider(env)),
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

function parseGraphifyProvider(
  env: Readonly<Record<string, string | undefined>>,
): Partial<Pick<HarnessProjectConfigInput, "graphify">> {
  const graphify = {
    ...(env["GRAPHIFY_PROVIDER"] ? { provider: env["GRAPHIFY_PROVIDER"] } : {}),
    ...(env["GRAPHIFY_MODEL"] ? { model: env["GRAPHIFY_MODEL"] } : {}),
    ...(env["GRAPHIFY_BASE_URL"] ? { baseUrl: env["GRAPHIFY_BASE_URL"] } : {}),
    ...(env["GRAPHIFY_API_KEY_ENV"] ? { apiKeyEnv: env["GRAPHIFY_API_KEY_ENV"] } : {}),
  };
  return Object.keys(graphify).length > 0 ? { graphify } : {};
}
