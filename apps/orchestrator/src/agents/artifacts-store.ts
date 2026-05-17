import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import simpleGit from "simple-git";
import { z } from "zod";
import {
  BrainstormArtifactSchema,
  PlanArtifactSchema,
  ProofReportSchema,
  parseArtifact,
  stringifyArtifact,
  type Artifact,
  type ArtifactKind,
  type ArtifactStatus,
  type BrainstormMock,
  type BrainstormMockManifest,
  type BrainstormArtifact,
  type PlanArtifact,
  type ProofReport,
} from "@pi-harness/shared";
import { withGitLockDiagnostic } from "../runner/git-diagnostics.js";

const SafeSlugSchema = z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/);

const BrainstormMockPageSchema = z.object({
  pageId: SafeSlugSchema,
  title: z.string().min(1),
  summary: z.string().min(1).optional(),
  htmlPath: z.string().min(1),
});

const BrainstormMockMiniatureSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("rows"),
    rows: z
      .array(
        z.object({
          status: z.enum(["pass", "fail", "muted"]),
          label: z.string().min(1),
          sub: z.string().min(1).optional(),
          action: z.string().min(1).optional(),
        }),
      )
      .min(1)
      .max(8),
  }),
  z.object({
    kind: z.literal("grid+drawer"),
    cells: z.array(z.object({ status: z.enum(["pass", "fail"]) })).min(1).max(8),
    drawerTitle: z.string().min(1),
    diffLines: z.array(z.object({ kind: z.enum(["plus", "minus"]) })).min(1).max(8),
    confirm: z.string().min(1),
  }),
]);

const BrainstormMockSchema = z.object({
  mockId: SafeSlugSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  recommended: z.boolean(),
  createdAt: z.string().min(1),
  derivedFrom: z.string().min(1).optional(),
  miniature: BrainstormMockMiniatureSchema.optional(),
  pages: z.array(BrainstormMockPageSchema).min(1).max(6),
});

const BrainstormMockManifestSchema = z.object({
  mocks: z.array(BrainstormMockSchema),
  selectedMockId: z.string().min(1).nullable(),
});

const BrainstormMockPageHtmlSchema = z.object({
  pageId: SafeSlugSchema,
  html: z.string().min(1),
});

function toBrainstormMock(value: z.infer<typeof BrainstormMockSchema>): BrainstormMock {
  const miniature =
    value.miniature === undefined ? undefined : toBrainstormMiniature(value.miniature);
  return {
    mockId: value.mockId,
    title: value.title,
    summary: value.summary,
    recommended: value.recommended,
    createdAt: value.createdAt,
    ...(value.derivedFrom !== undefined ? { derivedFrom: value.derivedFrom } : {}),
    ...(miniature !== undefined ? { miniature } : {}),
    pages: value.pages.map((page) => ({
      pageId: page.pageId,
      title: page.title,
      ...(page.summary !== undefined ? { summary: page.summary } : {}),
      htmlPath: page.htmlPath,
    })),
  };
}

function toBrainstormMiniature(
  value: z.infer<typeof BrainstormMockMiniatureSchema>,
): NonNullable<BrainstormMock["miniature"]> {
  if (value.kind === "rows") {
    return {
      kind: "rows",
      rows: value.rows.map((row) => ({
        status: row.status,
        label: row.label,
        ...(row.sub !== undefined ? { sub: row.sub } : {}),
        ...(row.action !== undefined ? { action: row.action } : {}),
      })),
    };
  }
  return {
    kind: "grid+drawer",
    cells: value.cells.map((cell) => ({ status: cell.status })),
    drawerTitle: value.drawerTitle,
    diffLines: value.diffLines.map((line) => ({ kind: line.kind })),
    confirm: value.confirm,
  };
}

// Per-kind on-disk file name. Markdown for prose artifacts; YAML for the
// plan phase's structured scenarios file (consumed by the verify phase).
// Centralized so callers never compose a path themselves.
export function artifactFileName(kind: ArtifactKind): string {
  if (kind === "scenarios" || kind === "blast-radius") return `${kind}.yaml`;
  return `${kind}.md`;
}

// Branch-scoped artifact store. Owns every read/write under
// `<worktree>/.harness/<taskId>/`. The brainstorm phase, brainstorm-tools,
// the run-loop's gate check, and the brainstorm GET route all go through
// here so no caller knows the literal paths.
//
// Layout (post plan-phase):
//   <cwd>/.harness/<taskId>/
//     ├── design.md       (frontmatter + body)
//     ├── spec.md         (frontmatter + body)
//     ├── plan.md         (frontmatter + body)
//     ├── scenarios.yaml  (frontmatter + body)
//     └── blast-radius.yaml (frontmatter + body)
//
// Legacy run-scoped artifacts (BrainstormArtifact / PlanArtifact /
// ProofReport JSON) live in LegacyRunArtifactsStore — separate class because
// only the not-yet-migrated plan/code/verify/pr phases consume them and
// we want one owner per directory tree.
export class ArtifactsStore {
  artifactDir(cwd: string, taskId: string): string {
    return join(cwd, ".harness", taskId);
  }

  artifactPath(cwd: string, taskId: string, kind: ArtifactKind): string {
    return join(this.artifactDir(cwd, taskId), artifactFileName(kind));
  }

  mockDir(cwd: string, taskId: string): string {
    return join(this.artifactDir(cwd, taskId), "mocks");
  }

  mockManifestPath(cwd: string, taskId: string): string {
    return join(this.mockDir(cwd, taskId), "manifest.json");
  }

  mockPageDir(cwd: string, taskId: string, mockId: string): string {
    return join(this.mockDir(cwd, taskId), mockId);
  }

  mockPageHtmlPath(cwd: string, taskId: string, mockId: string, pageId: string): string {
    return join(this.mockPageDir(cwd, taskId, mockId), `${pageId}.html`);
  }

  async readArtifact(cwd: string, taskId: string, kind: ArtifactKind): Promise<Artifact | null> {
    const path = this.artifactPath(cwd, taskId, kind);
    if (!existsSync(path)) return null;
    const raw = await readFile(path, "utf8");
    return parseArtifact(raw);
  }

  async listArtifacts(
    cwd: string,
    taskId: string,
    kinds: readonly ArtifactKind[] = ["design", "spec", "plan", "scenarios", "blast-radius"],
  ): Promise<Artifact[]> {
    const out: Artifact[] = [];
    for (const kind of kinds) {
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

  async readBrainstormMockManifest(
    cwd: string,
    taskId: string,
  ): Promise<BrainstormMockManifest> {
    const path = this.mockManifestPath(cwd, taskId);
    if (!existsSync(path)) return { mocks: [], selectedMockId: null };
    const raw = await readFile(path, "utf8");
    const parsed = BrainstormMockManifestSchema.parse(JSON.parse(raw));
    const mocks: BrainstormMock[] = parsed.mocks.map(toBrainstormMock);
    return { mocks, selectedMockId: parsed.selectedMockId };
  }

  async writeBrainstormMockManifest(
    cwd: string,
    taskId: string,
    manifest: BrainstormMockManifest,
  ): Promise<void> {
    const dir = this.mockDir(cwd, taskId);
    await mkdir(dir, { recursive: true });
    const finalPath = this.mockManifestPath(cwd, taskId);
    const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmpPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(tmpPath, finalPath);
  }

  async writeBrainstormMock(
    cwd: string,
    taskId: string,
    mock: BrainstormMock,
    pageHtml: ReadonlyArray<{ pageId: string; html: string }>,
  ): Promise<void> {
    const validatedMock = toBrainstormMock(BrainstormMockSchema.parse(mock));
    const validatedPageHtml = z.array(BrainstormMockPageHtmlSchema).parse(pageHtml);
    const dir = this.mockPageDir(cwd, taskId, validatedMock.mockId);
    await mkdir(dir, { recursive: true });
    for (const page of validatedPageHtml) {
      const finalPath = this.mockPageHtmlPath(cwd, taskId, validatedMock.mockId, page.pageId);
      const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(tmpPath, page.html);
      await rename(tmpPath, finalPath);
    }

    const manifest = await this.readBrainstormMockManifest(cwd, taskId);
    const mocks = [
      ...manifest.mocks.filter((m) => m.mockId !== validatedMock.mockId),
      validatedMock,
    ];
    await this.writeBrainstormMockManifest(cwd, taskId, {
      mocks,
      selectedMockId: manifest.selectedMockId,
    });
  }

  async readBrainstormMockHtml(
    cwd: string,
    taskId: string,
    mockId: string,
    pageId: string,
  ): Promise<string | null> {
    const path = this.mockPageHtmlPath(cwd, taskId, mockId, pageId);
    if (!existsSync(path)) return null;
    return readFile(path, "utf8");
  }

  async selectBrainstormMock(cwd: string, taskId: string, mockId: string): Promise<void> {
    const manifest = await this.readBrainstormMockManifest(cwd, taskId);
    if (!manifest.mocks.some((m) => m.mockId === mockId)) {
      throw new Error(`brainstorm mock ${mockId} not found for ${taskId}`);
    }
    await this.writeBrainstormMockManifest(cwd, taskId, {
      mocks: manifest.mocks,
      selectedMockId: mockId,
    });
  }

  // Read an artifact's contents as it existed at a specific git ref (commit
  // SHA, branch, or tag). Returns null when the file didn't exist at that
  // ref or the ref is unknown. Used by the diff endpoint to reconstruct the
  // pre-revision baseline so the dashboard can highlight what changed.
  async getArtifactAt(
    cwd: string,
    taskId: string,
    kind: ArtifactKind,
    gitRef: string,
  ): Promise<Artifact | null> {
    const relPath = `.harness/${taskId}/${artifactFileName(kind)}`;
    const git = simpleGit(cwd);
    try {
      const raw = await git.show([`${gitRef}:${relPath}`]);
      if (!raw) return null;
      return parseArtifact(raw);
    } catch {
      // simple-git rejects with a stderr-bearing GitError when the ref or
      // file is missing. Either case is "no baseline available" — treat as
      // null and let the caller decide how to render the empty state.
      return null;
    }
  }

  // Find the commit hash of the diff baseline for an artifact. The baseline
  // is the artifact's commit at the most recent brainstorm_revision_requested
  // timestamp (so the diff shows "what the agent changed since the user
  // last asked for revisions"). Falls back to the parent of the first
  // "mark <kind> as ready" commit when no revisions have been filed yet, so
  // the user always sees the agent's authored content vs the empty scaffold.
  // Returns null when there's no usable baseline (artifact never marked
  // ready and no revisions filed).
  async findDiffBaseline(
    cwd: string,
    taskId: string,
    kind: ArtifactKind,
    revisionTs: string | null,
  ): Promise<string | null> {
    const relPath = `.harness/${taskId}/${artifactFileName(kind)}`;
    const git = simpleGit(cwd);

    if (revisionTs) {
      // The newest commit touching this file at-or-before the revision
      // timestamp is the version the user was looking at when they asked
      // for changes. simple-git's log options object inconsistently quotes
      // timestamps; using raw avoids that fragility.
      try {
        const out = await git.raw([
          "log",
          `--before=${revisionTs}`,
          "-n",
          "1",
          "--format=%H",
          "--",
          relPath,
        ]);
        const hash = out.trim();
        return hash.length > 0 ? hash : null;
      } catch {
        return null;
      }
    }

    // No revisions yet. Preferred anchor: the parent of the first "mark
    // <kind> as ready" commit so the diff shows agent-authored vs scaffold.
    // Fallback: the first (chronologically earliest) commit touching the
    // artifact, used as the baseline directly (= scaffold body) so the
    // diff surfaces the agent's still-uncommitted writes against the
    // initial draft. This keeps the diff useful in the common case where
    // mark_ready writes the artifact but doesn't commit.
    let log;
    try {
      log = await git.log({ file: relPath });
    } catch {
      return null;
    }
    const all = [...log.all].reverse(); // chronological order
    const ready = all.find((c) => c.message.includes(`mark ${kind} as ready`));
    if (ready) {
      try {
        const parent = await git.raw(["rev-parse", `${ready.hash}^`]);
        const hash = parent.trim();
        return hash.length > 0 ? hash : ready.hash;
      } catch {
        return ready.hash;
      }
    }
    const first = all[0];
    return first ? first.hash : null;
  }

  // Move the current phase's files into runs/<runId>/ on the same task
  // branch, then commit the move. Brainstorm restarts archive brainstorm-owned
  // inputs; plan restarts archive plan-owned outputs while preserving
  // brainstorm-approved design.md/spec.md for the next preflight.
  //
  // Files (and the research/ directory) that don't exist are silently
  // skipped — partial-state runs still archive cleanly.
  async archiveCurrentRun(
    cwd: string,
    taskId: string,
    runId: string,
    phase: "brainstorm" | "plan",
  ): Promise<void> {
    const baseDir = this.artifactDir(cwd, taskId);
    const archiveDir = join(baseDir, "runs", runId);
    await mkdir(archiveDir, { recursive: true });
    const candidates = archiveFileNames(phase);
    const moved: string[] = [];
    for (const name of candidates) {
      const src = join(baseDir, name);
      if (!existsSync(src)) continue;
      const dst = join(archiveDir, name);
      await rename(src, dst);
      moved.push(join(".harness", taskId, "runs", runId, name));
    }
    const movedDirs = archiveDirectoryNames(phase);
    for (const name of movedDirs) {
      const src = join(baseDir, name);
      if (!existsSync(src)) continue;
      const dst = join(archiveDir, name);
      await rename(src, dst);
    }
    if (moved.length === 0) return;
    const git = simpleGit(cwd);
    // .harness is gitignored — same -f trick as setArtifactStatus.
    await withGitLockDiagnostic(
      { taskId, operation: `archive ${phase} run ${runId}` },
      async () => {
        await git.raw([
          "add",
          "-f",
          "--",
          ...moved,
          // Stage deletions of the originals too so the commit captures the move.
          join(".harness", taskId),
        ]);
        await git.commit(`chore(${taskId}): archive ${phase} run ${runId}`);
      },
    );
  }

  // Apply a user-authored edit to an artifact. Body is replaced verbatim;
  // frontmatter is preserved (only `status`, `last_updated`, and
  // `last_updated_by` change). Commits on the worktree's branch with a
  // human-attribution message so the diff endpoint can locate this revision
  // explicitly. Returns the new artifact + commit SHA so the caller can
  // surface it in the brainstorm_artifact_edited event.
  async applyHumanEdit(
    cwd: string,
    taskId: string,
    kind: ArtifactKind,
    body: string,
  ): Promise<{ artifact: Artifact; commitSha: string }> {
    const cur = await this.readArtifact(cwd, taskId, kind);
    if (!cur) throw new Error(`artifact ${kind}.md not found for ${taskId}`);
    const next: Artifact = {
      fm: {
        ...cur.fm,
        status: "human_edited",
        last_updated: new Date().toISOString(),
        last_updated_by: "human",
      },
      body,
    };
    await this.writeArtifact(cwd, taskId, next);
    const git = simpleGit(cwd);
    const fileName = artifactFileName(kind);
    const commit = await withGitLockDiagnostic(
      { taskId, operation: `human edit ${fileName}` },
      async () => {
        await git.raw(["add", "-f", join(".harness", taskId, fileName)]);
        return git.commit(`human(${taskId}): edit ${fileName}`);
      },
    );
    return { artifact: next, commitSha: commit.commit };
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
    // .harness/ is gitignored at the repo root; force-add so the commit
    // captures the artifact-status flip just like the scaffolding commit
    // does (see scaffold-brainstorm.ts).
    await withGitLockDiagnostic(
      { taskId, operation: `mark ${kind} as ${status}` },
      async () => {
        await git.raw(["add", "-f", join(".harness", taskId, artifactFileName(kind))]);
        await git.commit(`chore(${taskId}): mark ${kind} as ${status}`);
      },
    );
    return next;
  }
}

function archiveFileNames(phase: "brainstorm" | "plan"): ReadonlyArray<string> {
  if (phase === "brainstorm") {
    return ["design.md", "spec.md", "brainstorm.jsonl", "pi-session.jsonl"];
  }
  return [
    "plan.md",
    "scenarios.yaml",
    "blast-radius.yaml",
    "plan.jsonl",
    "pi-session-plan.jsonl",
  ];
}

function archiveDirectoryNames(phase: "brainstorm" | "plan"): ReadonlyArray<string> {
  return phase === "brainstorm" ? ["mocks"] : ["research"];
}

// Legacy run-scoped artifact store. Reads/writes JSON+MD pairs under
// `<runsDir>/<taskId>/` for plan, brainstorm (old shape), and proof report.
// Only consumed by plan/code/verify/pr — phases that today return
// `not_implemented` from runPhase. Kept until those phases migrate to the
// branch-scoped Artifact API; that migration deletes this class.
export class LegacyRunArtifactsStore {
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
  return `# generated by verification-author\n${JSON.stringify(file, null, 2)}`;
}
