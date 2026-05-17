#!/usr/bin/env node
import { applyInitPlan, createInitPlan } from "./init.js";
import { formatDoctorResult, runDoctor } from "./doctor.js";
import { runDev } from "./dev.js";
import { nodeExecFile } from "./exec.js";

type Command = "init" | "doctor" | "dev";

async function main(argv: ReadonlyArray<string>): Promise<number> {
  const command = readCommand(argv);
  if (!command) {
    console.error("Usage: pi-harness <init|doctor|dev> [--check-only]");
    return 1;
  }
  if (command === "init") return runInit();
  if (command === "doctor") return runDoctorCommand();
  return runDevCommand(argv.includes("--check-only"));
}

async function runInit(): Promise<number> {
  const plan = await createInitPlan({ cwd: process.cwd(), env: process.env, execFile: nodeExecFile });
  if (!plan.ok) {
    console.error(plan.message);
    return 1;
  }
  await applyInitPlan(plan.config.repoRoot, plan);
  const doctor = await runDoctor({ cwd: plan.config.repoRoot, env: process.env, execFile: nodeExecFile });
  process.stdout.write(formatDoctorResult(doctor));
  console.log("Next: copy .env.harness.example to .env.harness, add provider keys, then run pi-harness dev.");
  return doctor.ok ? 0 : 1;
}

async function runDoctorCommand(): Promise<number> {
  const result = await runDoctor({ cwd: process.cwd(), env: process.env, execFile: nodeExecFile });
  process.stdout.write(formatDoctorResult(result));
  return result.ok ? 0 : 1;
}

async function runDevCommand(checkOnly: boolean): Promise<number> {
  const result = await runDev({ cwd: process.cwd(), env: process.env, execFile: nodeExecFile, checkOnly });
  if (!result.ok) {
    console.error(result.message);
    return 1;
  }
  console.log(`Dashboard: ${result.dashboardUrl}`);
  return 0;
}

function readCommand(argv: ReadonlyArray<string>): Command | null {
  const raw = argv[2];
  if (raw === "init" || raw === "doctor" || raw === "dev") return raw;
  return null;
}

main(process.argv).then((code) => {
  process.exitCode = code;
});
