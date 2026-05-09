import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import simpleGit from "simple-git";
import {
  BrainstormArtifactSchema,
  PlanArtifactSchema,
  ProofReportSchema,
  parseArtifact,
  stringifyArtifact,
  type Artifact,
  type ArtifactKind,
  type ArtifactStatus,
  type BrainstormArtifact,
  type PlanArtifact,
  type ProofReport,
} from "@pi-harness/shared";

// Centralizes filesystem layout for `.harness/runs/<task-id>/`. Every phase
// driver reads/writes through here so no driver knows the literal paths.
//
// Layout:
//   <runsDir>/<task-id>/
//     ├── brainstorm.json   (machine-readable)
//     ├── brainstorm.md     (human/dashboard-readable)
//     ├── plan.json
//     ├── plan.md
//     ├── verification.yaml (handed off from plan to verify)
//     └── proof/
//         ├── proof-report.json
//         ├── proof-report.md
//         ├── responses/
//         └── screenshots/
export class ArtifactsStore {
  private readonly runsDir: string;

  constructor(opts: { runsDir: string }) {
    this.runsDir = resolve(opts.runsDir);
  }

  runDir(taskId: string): string {
    return join(this.runsDir, taskId);
  }

  proofDir(taskId: string): string {
    return join(this.runDir(taskId), "proof");
  }

  // -------------------------------------------------------------------------
  // Branch-scoped Artifact API (design doc decisions §1, §2, §6, §9).
  //
  // These methods write and read individual artifacts (design.md, spec.md)
  // inside a worktree at `<cwd>/.harness/<taskId>/`. They are independent of
  // the `runsDir` used by the legacy *Brainstorm/Plan/ProofReport APIs.
  //
  // `cwd` is the worktree path; the run-loop threads it in.
  // -------------------------------------------------------------------------

  artifactDir(cwd: string, taskId: string): string {
    return join(cwd, ".harness", taskId);
  }

  artifactPath(cwd: string, taskId: string, kind: ArtifactKind): string {
    return join(this.artifactDir(cwd, taskId), `${kind}.md`);
  }

  async readArtifact(cwd: string, taskId: string, kind: ArtifactKind): Promise<Artifact | null> {
    const path = this.artifactPath(cwd, taskId, kind);
    if (!existsSync(path)) return null;
    const raw = await readFile(path, "utf8");
    return parseArtifact(raw);
  }

  async listArtifacts(cwd: string, taskId: string): Promise<Artifact[]> {
    const out: Artifact[] = [];
    for (const kind of ["design", "spec"] as const) {
      const a = await this.readArtifact(cwd, taskId, kind);
      if (a) out.push(a);
    }
    return out;
  }

  // Atomic write: write to a sibling temp file then rename. Same partition
  // guarantees rename is atomic on POSIX; readers either see the prior file
  // or the new one, never a half-written one.
  async writeArtifact(cwd: string, taskId: string, art: Artifact): Promise<void> {
    const dir = this.artifactDir(cwd, taskId);
    await mkdir(dir, { recursive: true });
    const finalPath = this.artifactPath(cwd, taskId, art.fm.kind);
    const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmpPath, stringifyArtifact(art));
    await rename(tmpPath, finalPath);
  }

  // Helper used by the approval gate: read the artifact, mutate its status,
  // bump last_updated, write atomically, then commit on the worktree's branch.
  async setArtifactStatus(
    cwd: string,
    taskId: string,
    kind: ArtifactKind,
    status: ArtifactStatus,
    actor: string,
  ): Promise<Artifact> {
    const cur = await this.readArtifact(cwd, taskId, kind);
    if (!cur) throw new Error(`artifact ${kind}.md not found for ${taskId}`);
    const next: Artifact = {
      fm: {
        ...cur.fm,
        status,
        last_updated: new Date().toISOString(),
        last_updated_by: actor,
      },
      body: cur.body,
    };
    await this.writeArtifact(cwd, taskId, next);
    const git = simpleGit(cwd);
    await git.add([join(".harness", taskId, `${kind}.md`)]);
    await git.commit(`chore(${taskId}): mark ${kind} as ${status}`);
    return next;
  }

  // -------------------------------------------------------------------------
  // Legacy run-scoped API (BrainstormArtifact / PlanArtifact / ProofReport).
  // Kept while the plan / verify phases still consume the old shape. Phase 4
  // migrates brainstorm off this; plan/verify migration is deferred.
  // -------------------------------------------------------------------------

  async writeBrainstorm(taskId: string, art: BrainstormArtifact): Promise<void> {
    const dir = this.runDir(taskId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "brainstorm.json"), JSON.stringify(art, null, 2));
    await writeFile(join(dir, "brainstorm.md"), brainstormToMd(art));
  }

  async readBrainstorm(taskId: string): Promise<BrainstormArtifact> {
    const raw = await readFile(join(this.runDir(taskId), "brainstorm.json"), "utf8");
    return BrainstormArtifactSchema.parse(JSON.parse(raw)) as BrainstormArtifact;
  }

  async writePlan(taskId: string, art: PlanArtifact): Promise<void> {
    const dir = this.runDir(taskId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "plan.json"), JSON.stringify(art, null, 2));
    await writeFile(join(dir, "plan.md"), planToMd(art));
    await writeFile(
      join(dir, "verification.yaml"),
      scenariosToYaml(art.verificationScenarios),
    );
  }

  async readPlan(taskId: string): Promise<PlanArtifact> {
    const raw = await readFile(join(this.runDir(taskId), "plan.json"), "utf8");
    return PlanArtifactSchema.parse(JSON.parse(raw)) as PlanArtifact;
  }

  async writeProofReport(taskId: string, report: ProofReport): Promise<void> {
    const dir = this.proofDir(taskId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "proof-report.json"), JSON.stringify(report, null, 2));
    await writeFile(join(dir, "proof-report.md"), proofToMd(report));
  }

  async readProofReport(taskId: string): Promise<ProofReport> {
    const raw = await readFile(
      join(this.proofDir(taskId), "proof-report.json"),
      "utf8",
    );
    return ProofReportSchema.parse(JSON.parse(raw)) as ProofReport;
  }
}

function brainstormToMd(a: BrainstormArtifact): string {
  return [
    `# Brainstorm`,
    ``,
    `## Goal`,
    a.goal,
    ``,
    `## Decisions`,
    ...a.decisions.map((d) => `- ${d}`),
    ``,
    `## Open questions`,
    ...a.openQuestions.map((q, i) => `${i + 1}. ${q}`),
    ``,
    `## Suggested workflow`,
    `\`${a.suggestedWorkflow}\``,
  ].join("\n");
}

function planToMd(a: PlanArtifact): string {
  return [
    `# Plan`,
    ``,
    `## Goal`,
    a.goal,
    ``,
    `## Patterns to follow`,
    ...a.patternsToFollow.map((p) => `- \`${p.ref}\` — ${p.note}`),
    ``,
    `## Touchpoints`,
    ...a.touchpoints.map(
      (t) => `### ${t.layer}\n${t.files.map((f) => `- \`${f}\``).join("\n")}\n\n${t.finding}`,
    ),
    ``,
    `## Steps`,
    ...a.steps.map(
      (s) =>
        `### ${s.id}: ${s.title}\n` +
        s.files.map((f) => `- ${f.action} \`${f.path}\``).join("\n") +
        (s.patternRef ? `\n\nPattern: \`${s.patternRef}\`` : "") +
        `\n\nDone when: ${s.assertion}`,
    ),
    ``,
    `## Out of scope`,
    ...a.outOfScope.map((o) => `- ${o}`),
  ].join("\n\n");
}

function proofToMd(r: ProofReport): string {
  const lines = [
    `# Proof Report`,
    ``,
    `**Run:** \`${r.runId}\`  `,
    `**Result:** ${r.ok ? "✅ all green" : "❌ failures present"}  `,
    ``,
    `## Scenarios`,
  ];
  for (const s of r.scenarios) {
    lines.push(
      `\n### ${s.ok ? "✓" : "✗"} \`${s.id}\` (${s.type})`,
      ...(s.error ? [``, `**Error:** ${s.error}`] : []),
      ...(s.evidence.responseFile ? [``, `Response: \`${s.evidence.responseFile}\``] : []),
      ...(s.evidence.screenshotFile
        ? [``, `Screenshot: \`${s.evidence.screenshotFile}\``]
        : []),
    );
  }
  return lines.join("\n");
}

function scenariosToYaml(file: { scenarios: unknown[] }): string {
  // Lightweight serializer; we don't need full yaml fidelity, just round-trip.
  // The verification-author subagent emits canonical yaml; we just persist it.
  // For programmatic use we serialize via JSON.stringify and rely on the yaml
  // parser being lenient enough. (js-yaml is added in Task 2.)
  return `# generated by verification-author\n${JSON.stringify(file, null, 2)}`;
}
