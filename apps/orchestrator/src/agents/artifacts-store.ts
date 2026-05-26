import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
  if (kind === "scenarios" || kind === "blast-radius" || kind === "execution-dag") {
    return `${kind}.yaml`;
  }
  return `${kind}.md`;
}

type ArtifactWriteResult = {
  readonly artifact: Artifact;
  readonly artifactRevisionId: string;
};

type ArtifactsStoreOptions = {
  readonly stateDir?: string;
};

// Durable artifact store. Canonical state lives under
// `<stateDir>/tasks/<taskId>/artifacts/current/` with revision history under
// `artifacts/history/`; `<worktree>/.harness/<taskId>/` remains the
// agent-facing execution mirror.
//
// Layout (post plan-phase):
//   <stateDir>/tasks/<taskId>/artifacts/current/
//     ├── design.md
//     ├── spec.md
//     ├── plan.md
//     ├── scenarios.yaml
//     └── blast-radius.yaml
//
// Legacy run-scoped artifacts (BrainstormArtifact / PlanArtifact /
// ProofReport JSON) live in LegacyRunArtifactsStore — separate class because
// only the not-yet-migrated plan/code/verify/pr phases consume them and
// we want one owner per directory tree.
export class ArtifactsStore {
  private readonly stateDir: string | null;

  constructor(opts: ArtifactsStoreOptions = {}) {
    this.stateDir = opts.stateDir ? resolve(opts.stateDir) : null;
  }

  stateRoot(cwd: string): string {
    return this.stateDir ?? join(resolve(cwd), ".harness");
  }

  taskDir(cwd: string, taskId: string): string {
    return join(this.stateRoot(cwd), "tasks", taskId);
  }

  currentArtifactDir(cwd: string, taskId: string): string {
    return join(this.taskDir(cwd, taskId), "artifacts", "current");
  }

  currentArtifactPath(cwd: string, taskId: string, kind: ArtifactKind): string {
    return join(this.currentArtifactDir(cwd, taskId), artifactFileName(kind));
  }

  artifactHistoryDir(cwd: string, taskId: string, kind: ArtifactKind): string {
    return join(this.taskDir(cwd, taskId), "artifacts", "history", kind);
  }

  taskRunDir(cwd: string, taskId: string, runId: string): string {
    return join(this.taskDir(cwd, taskId), "runs", runId);
  }

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
    await this.syncMirrorIfNewer(cwd, taskId, kind);
    const path = this.currentArtifactPath(cwd, taskId, kind);
    if (!existsSync(path)) return null;
    const raw = await readFile(path, "utf8");
    return parseArtifact(raw);
  }

  async listArtifacts(
    cwd: string,
    taskId: string,
    kinds: readonly ArtifactKind[] = [
      "design",
      "spec",
      "plan",
      "scenarios",
      "blast-radius",
      "execution-dag",
    ],
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
    await this.writeArtifactWithRevision(cwd, taskId, art);
  }

  private async writeArtifactWithRevision(
    cwd: string,
    taskId: string,
    art: Artifact,
  ): Promise<ArtifactWriteResult> {
    const serialized = stringifyArtifact(art);
    const currentPath = this.currentArtifactPath(cwd, taskId, art.fm.kind);
    const mirrorPath = this.artifactPath(cwd, taskId, art.fm.kind);
    await atomicWrite(currentPath, serialized);
    await atomicWrite(mirrorPath, serialized);
    const artifactRevisionId = await this.writeRevision(cwd, taskId, art, serialized);
    return { artifact: art, artifactRevisionId };
  }

  private async writeRevision(
    cwd: string,
    taskId: string,
    art: Artifact,
    serialized: string,
  ): Promise<string> {
    const revisionId = createRevisionId();
    const revisionPath = join(
      this.artifactHistoryDir(cwd, taskId, art.fm.kind),
      `${revisionId}.${artifactFileName(art.fm.kind)}`,
    );
    await atomicWrite(revisionPath, serialized);
    return revisionId;
  }

  private async syncMirrorIfNewer(cwd: string, taskId: string, kind: ArtifactKind): Promise<void> {
    const currentPath = this.currentArtifactPath(cwd, taskId, kind);
    const mirrorPath = this.artifactPath(cwd, taskId, kind);
    if (!existsSync(mirrorPath)) return;
    if (existsSync(currentPath)) {
      const [mirrorStats, currentStats] = await Promise.all([stat(mirrorPath), stat(currentPath)]);
      if (mirrorStats.mtimeMs <= currentStats.mtimeMs) return;
    }
    const raw = await readFile(mirrorPath, "utf8");
    const artifact = parseArtifact(raw);
    await atomicWrite(currentPath, raw);
    await this.writeRevision(cwd, taskId, artifact, raw);
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
    revisionId: string,
  ): Promise<Artifact | null> {
    const revisionPath = join(
      this.artifactHistoryDir(cwd, taskId, kind),
      `${revisionId}.${artifactFileName(kind)}`,
    );
    if (existsSync(revisionPath)) {
      const raw = await readFile(revisionPath, "utf8");
      return parseArtifact(raw);
    }

    const relPath = `.harness/${taskId}/${artifactFileName(kind)}`;
    try {
      const git = simpleGit(cwd);
      const raw = await git.show([`${revisionId}:${relPath}`]);
      if (!raw) return null;
      return parseArtifact(raw);
    } catch {
      try {
        const git = simpleGit(cwd);
        const currentRelPath = join(
          ".harness",
          "tasks",
          taskId,
          "artifacts",
          "current",
          artifactFileName(kind),
        );
        const raw = await git.show([`${revisionId}:${currentRelPath}`]);
        if (!raw) return null;
        return parseArtifact(raw);
      } catch {
        return null;
      }
    }
  }

  async findDiffBaseline(
    cwd: string,
    taskId: string,
    kind: ArtifactKind,
    revisionTs: string | null,
  ): Promise<string | null> {
    await this.syncMirrorIfNewer(cwd, taskId, kind);
    const revisions = await this.readRevisionIndex(cwd, taskId, kind);
    if (revisions.length > 0) {
      if (revisionTs) {
        const before = revisions
          .filter((r) => r.updatedAt <= revisionTs)
          .at(-1);
        return before?.revisionId ?? null;
      }
      return revisions[0]?.revisionId ?? null;
    }

    return this.findLegacyGitDiffBaseline(cwd, taskId, kind, revisionTs);
  }

  private async readRevisionIndex(
    cwd: string,
    taskId: string,
    kind: ArtifactKind,
  ): Promise<ReadonlyArray<{ readonly revisionId: string; readonly updatedAt: string }>> {
    const dir = this.artifactHistoryDir(cwd, taskId, kind);
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir);
    const suffix = `.${artifactFileName(kind)}`;
    const parsed = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(suffix))
        .map(async (entry) => {
          const path = join(dir, entry);
          const stats = await stat(path);
          return {
            revisionId: entry.slice(0, -suffix.length),
            updatedAt: stats.mtime.toISOString(),
          };
        }),
    );
    return [...parsed].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }

  private async findLegacyGitDiffBaseline(
    cwd: string,
    taskId: string,
    kind: ArtifactKind,
    revisionTs: string | null,
  ): Promise<string | null> {
    const relPath = `.harness/${taskId}/${artifactFileName(kind)}`;
    const git = simpleGit(cwd);

    if (revisionTs) {
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

    let log;
    try {
      log = await git.log({ file: relPath });
    } catch {
      return null;
    }
    const all = [...log.all].reverse();
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

  /*
   * Move the current phase's files into runs/<runId>/ in central task state.
   * Worktree mirror files are removed as cleanup only; dashboard/API reads do
   * not depend on them after archive.
   */
  async archiveCurrentRun(
    cwd: string,
    taskId: string,
    runId: string,
    phase: "brainstorm" | "plan",
  ): Promise<void> {
    const archiveDir = this.taskRunDir(cwd, taskId, runId);
    await mkdir(archiveDir, { recursive: true });
    const candidates = archiveFileNames(phase);
    for (const name of candidates) {
      await moveFirstExisting(
        [
          join(this.currentArtifactDir(cwd, taskId), name),
          join(this.artifactDir(cwd, taskId), name),
        ],
        join(archiveDir, name),
      );
    }
    for (const name of archiveDirectoryNames(phase)) {
      await moveFirstExisting(
        [
          join(this.taskDir(cwd, taskId), name),
          join(this.artifactDir(cwd, taskId), name),
        ],
        join(archiveDir, name),
      );
    }
  }

  /*
   * Apply a user-authored edit to an artifact. Body is replaced verbatim;
   * frontmatter is preserved (only `status`, `last_updated`, and
   * `last_updated_by` change). Returns a central artifact revision id. The
   * `commitSha` alias remains for older dashboard/event consumers.
   */
  async applyHumanEdit(
    cwd: string,
    taskId: string,
    kind: ArtifactKind,
    body: string,
  ): Promise<{ artifact: Artifact; artifactRevisionId: string; commitSha: string }> {
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
    const result = await this.writeArtifactWithRevision(cwd, taskId, next);
    return {
      artifact: result.artifact,
      artifactRevisionId: result.artifactRevisionId,
      commitSha: result.artifactRevisionId,
    };
  }

  /*
   * Helper used by approval gates: mutate frontmatter, write atomically to
   * central state + mirror, and record a revision. No git commit is created.
   */
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
    await this.writeArtifactWithRevision(cwd, taskId, next);
    return next;
  }

}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  await writeFile(tmpPath, content);
  await rename(tmpPath, path);
}

function createRevisionId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
}

async function moveFirstExisting(sources: ReadonlyArray<string>, destination: string): Promise<void> {
  const src = sources.find((candidate) => existsSync(candidate));
  if (!src) return;
  await mkdir(dirname(destination), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await rename(src, destination).catch(async () => {
    await cp(src, destination, { recursive: true });
    await rm(src, { recursive: true, force: true });
  });
  await Promise.all(
    sources
      .filter((candidate) => candidate !== src && existsSync(candidate))
      .map((candidate) => rm(candidate, { recursive: true, force: true })),
  );
}

function archiveFileNames(phase: "brainstorm" | "plan"): ReadonlyArray<string> {
  if (phase === "brainstorm") {
    return ["design.md", "spec.md", "brainstorm.jsonl", "pi-session.jsonl"];
  }
  return [
    "plan.md",
    "scenarios.yaml",
    "blast-radius.yaml",
    "execution-dag.yaml",
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
