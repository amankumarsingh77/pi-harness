import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  DesignSystemManifestSchema,
  emptyManifest,
  type DesignSystemManifest,
} from "./design-system-types.js";

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
}
