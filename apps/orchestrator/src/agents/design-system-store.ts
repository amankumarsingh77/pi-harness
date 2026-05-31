import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DesignSystemManifestSchema,
  emptyManifest,
  type DesignSystemManifest,
} from "./design-system-types.js";

const execFileAsync = promisify(execFile);

export type DesignSystemSnapshot = {
  exists: boolean;
  tokensCss: string;
  designMd: string;
  manifest: DesignSystemManifest;
};

export type DesignSystemStoreOptions = { stateDir?: string };

export class DesignSystemStore {
  private readonly stateDir: string | null;
  constructor(opts: DesignSystemStoreOptions = {}) {
    this.stateDir = opts.stateDir ? resolve(opts.stateDir) : null;
  }

  stateRoot(cwd: string): string {
    return this.stateDir ?? join(resolve(cwd), ".harness");
  }
  designDir(cwd: string): string {
    return join(this.stateRoot(cwd), "design");
  }
  tokensPath(cwd: string): string {
    return join(this.designDir(cwd), "tokens.css");
  }
  designMdPath(cwd: string): string {
    return join(this.designDir(cwd), "DESIGN.md");
  }
  manifestPath(cwd: string): string {
    return join(this.designDir(cwd), "manifest.json");
  }
  galleryDir(cwd: string): string {
    return join(this.designDir(cwd), "gallery");
  }

  draftDir(cwd: string, taskId: string): string {
    return join(this.stateRoot(cwd), taskId, "design-draft");
  }
  private draftTokensPath(cwd: string, taskId: string): string {
    return join(this.draftDir(cwd, taskId), "tokens.css");
  }
  async writeDraftTokens(cwd: string, taskId: string, css: string): Promise<void> {
    await mkdir(this.draftDir(cwd, taskId), { recursive: true });
    await this.atomicWrite(this.draftTokensPath(cwd, taskId), css);
  }
  async readDraftTokens(cwd: string, taskId: string): Promise<string> {
    const p = this.draftTokensPath(cwd, taskId);
    return existsSync(p) ? readFile(p, "utf8") : "";
  }

  async read(cwd: string): Promise<DesignSystemSnapshot> {
    const mPath = this.manifestPath(cwd);
    if (!existsSync(mPath)) {
      return { exists: false, tokensCss: "", designMd: "", manifest: emptyManifest() };
    }
    const manifest = DesignSystemManifestSchema.parse(JSON.parse(await readFile(mPath, "utf8")));
    const tokensCss = existsSync(this.tokensPath(cwd)) ? await readFile(this.tokensPath(cwd), "utf8") : "";
    const designMd = existsSync(this.designMdPath(cwd)) ? await readFile(this.designMdPath(cwd), "utf8") : "";
    return { exists: true, tokensCss, designMd, manifest };
  }

  private writeChain: Promise<unknown> = Promise.resolve();

  private async atomicWrite(path: string, data: string | Buffer): Promise<void> {
    const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(tmp, data);
    await rename(tmp, path);
  }

  async writePromotion(
    cwd: string,
    input: {
      tokensCss: string;
      designMdDelta: string;
      summary: string;
      task: string;
      exemplar: { title: string; pngBytes: Buffer; promotedMockId: string };
    },
  ): Promise<{ tokenVersion: number; exemplarId: string }> {
    const run = this.writeChain.then(() => this.writePromotionUnsafe(cwd, input));
    // keep the chain alive even if this promotion rejects
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  private async writePromotionUnsafe(
    cwd: string,
    input: {
      tokensCss: string;
      designMdDelta: string;
      summary: string;
      task: string;
      exemplar: { title: string; pngBytes: Buffer; promotedMockId: string };
    },
  ): Promise<{ tokenVersion: number; exemplarId: string }> {
    await mkdir(this.galleryDir(cwd), { recursive: true });
    const current = await this.read(cwd);
    const tokenVersion = current.manifest.tokenVersion + 1;
    const exemplarId = `ex_${randomUUID().slice(0, 8)}`;
    const updatedAt = new Date().toISOString();

    await this.atomicWrite(join(this.galleryDir(cwd), `${exemplarId}.png`), input.exemplar.pngBytes);
    await this.atomicWrite(
      join(this.galleryDir(cwd), `${exemplarId}.meta.json`),
      `${JSON.stringify(
        { id: exemplarId, title: input.exemplar.title, promotedFromTask: input.task, promotedMockId: input.exemplar.promotedMockId, tokenVersion },
        null,
        2,
      )}\n`,
    );
    await this.atomicWrite(this.tokensPath(cwd), input.tokensCss);
    const nextDesignMd = current.designMd
      ? `${current.designMd.trimEnd()}\n\n${input.designMdDelta}\n`
      : `${input.designMdDelta}\n`;
    await this.atomicWrite(this.designMdPath(cwd), nextDesignMd);

    const manifest = {
      tokenVersion,
      updatedAt,
      exemplars: [
        ...current.manifest.exemplars,
        {
          id: exemplarId,
          title: input.exemplar.title,
          png: `gallery/${exemplarId}.png`,
          promotedFromTask: input.task,
          promotedMockId: input.exemplar.promotedMockId,
          tokenVersion,
        },
      ],
      history: [...current.manifest.history, { tokenVersion, task: input.task, summary: input.summary }],
    };
    await this.atomicWrite(this.manifestPath(cwd), `${JSON.stringify(manifest, null, 2)}\n`);
    return { tokenVersion, exemplarId };
  }

  async commitToMain(cwd: string, message: string): Promise<void> {
    const root = resolve(cwd);
    await execFileAsync("git", ["add", "--", this.designDir(cwd)], { cwd: root });
    // No-op safety: if nothing is staged, `git commit` exits non-zero — tolerate it.
    try {
      await execFileAsync("git", ["commit", "-m", message], { cwd: root });
    } catch (err) {
      const out = String((err as { stdout?: string }).stdout ?? "");
      if (!out.includes("nothing to commit")) throw err;
    }
  }
}
