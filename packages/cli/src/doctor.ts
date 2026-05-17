import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HarnessProjectConfig } from "@pi-harness/shared";
import { loadProjectConfig } from "./config.js";
import type { ExecFile } from "./exec.js";

export type DoctorCheck = {
  readonly name: string;
  readonly ok: boolean;
  readonly message: string;
};

export type DoctorResult = {
  readonly ok: boolean;
  readonly checks: ReadonlyArray<DoctorCheck>;
  readonly config: HarnessProjectConfig | null;
};

export async function runDoctor(opts: {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly execFile: ExecFile;
}): Promise<DoctorResult> {
  const loaded = await loadProjectConfig(opts);
  if (!loaded.ok) {
    return {
      ok: false,
      config: null,
      checks: [{ name: "config", ok: false, message: loaded.message }],
    };
  }

  const runtime = await opts.execFile(loaded.config.containerRuntime, ["--version"]);
  const composeFile = join(loaded.config.stateDir, "runtime", "compose.yml");
  const checks: ReadonlyArray<DoctorCheck> = [
    { name: "config", ok: true, message: "harness.config.ts loaded" },
    {
      name: "container-runtime",
      ok: runtime.ok,
      message: runtime.ok ? `${loaded.config.containerRuntime} is available` : `${loaded.config.containerRuntime} is not available`,
    },
    {
      name: "compose-file",
      ok: existsSync(composeFile),
      message: existsSync(composeFile) ? "runtime compose file exists" : "missing .harness/runtime/compose.yml",
    },
    {
      name: "env-example",
      ok: existsSync(join(loaded.config.repoRoot, ".env.harness.example")),
      message: "provider key template exists",
    },
  ];
  return {
    ok: checks.every((check) => check.ok),
    checks,
    config: loaded.config,
  };
}

export function formatDoctorResult(result: DoctorResult): string {
  const lines = result.checks.map((check) => {
    const mark = check.ok ? "ok" : "fail";
    return `${mark} ${check.name}: ${check.message}`;
  });
  return `${lines.join("\n")}\n`;
}
