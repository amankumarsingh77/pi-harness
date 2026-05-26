import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LegacyRunArtifactsStore } from "./artifacts-store.js";

type ExecResult = { ok: boolean; stdout: string; stderr?: string };
type Exec = (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<ExecResult>;

export type PrOpts = {
  taskId: string;
  branch: string;
  cwd: string;
  store: LegacyRunArtifactsStore;
  exec: Exec;
};

export type PrResult = { ok: true; url: string } | { ok: false; error: string };

export async function runPr(opts: PrOpts): Promise<PrResult> {
  const plan = await opts.store.readPlan(opts.taskId);
  const proof = await opts.store.readProofReport(opts.taskId);

  // 1. Push the branch.
  const push = await opts.exec("git", ["push", "-u", "origin", opts.branch], { cwd: opts.cwd });
  if (!push.ok) return { ok: false, error: `git push failed: ${push.stderr ?? "unknown"}` };

  // 2. Build the PR body in a temp file (gh pr create body via @file).
  const title = derivePrTitle(plan.goal);
  const body = buildPrBody(plan, proof);
  const tmpDir = await mkdtemp(join(tmpdir(), "pr-body-"));
  const bodyFile = join(tmpDir, "body.md");
  try {
    await writeFile(bodyFile, body);

    const ghArgs = ["pr", "create", "--title", title, "--body", body, "--head", opts.branch];
    const gh = await opts.exec("gh", ghArgs, { cwd: opts.cwd });
    if (!gh.ok) return { ok: false, error: `gh pr create failed: ${gh.stderr ?? "unknown"}` };

    const url = gh.stdout.trim().split("\n").pop() ?? "";
    return { ok: true, url };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// "Retry webhooks bounded." → "feat: retry webhooks bounded"
// (default to feat:; v1.5 derives prefix from commit messages.)
function derivePrTitle(goal: string): string {
  const trimmed = goal.replace(/\.$/, "");
  const lower = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  return `feat: ${lower}`;
}

function buildPrBody(
  plan: { goal: string; verificationScenarios: { scenarios: { id: string; name: string }[] } },
  proof: { ok: boolean; scenarios: { id: string; ok: boolean; type: string }[] },
): string {
  const summary = `## Summary\n\n${plan.goal}\n`;
  const scenarioBullets = proof.scenarios.map(
    (s) => `- ${s.ok ? "✅" : "❌"} \`${s.id}\` (${s.type})`,
  );
  const verification = `## Verification\n\n${proof.ok ? "All scenarios green." : "Failures present."}\n\n${scenarioBullets.join("\n")}\n`;
  const planLink = `## Plan\n\nSee the task artifact view for the approved plan and verification report.\n`;
  return [summary, planLink, verification].join("\n");
}
