import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildModelCatalog } from "./model-catalog.js";

let prevCwd: string;
let envDir: string;

beforeEach(() => {
  prevCwd = process.cwd();
  envDir = mkdtempSync(join(tmpdir(), "pi-model-catalog-"));
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(envDir, { recursive: true, force: true });
  delete process.env["CROFAI_API_KEY"];
  delete process.env["OPENAI_API_KEY"];
});

describe("buildModelCatalog", () => {
  it("lists pi built-in providers and the CrofAI custom provider", () => {
    const catalog = buildModelCatalog({ env: {} });
    const providerIds = catalog.providers.map((provider) => provider.id);

    expect(providerIds).toContain("openai");
    expect(providerIds).toContain("crofai");

    const crofai = catalog.providers.find((provider) => provider.id === "crofai");
    expect(crofai).toMatchObject({
      id: "crofai",
      label: "CrofAI",
      credential: {
        kind: "env",
        configured: false,
        requiredEnvVars: ["CROFAI_API_KEY"],
      },
    });
    expect(crofai?.models.map((model) => model.id)).toContain("kimi-k2.6");
  });

  it("reports configured env-backed providers without leaking secret values", () => {
    const catalog = buildModelCatalog({
      env: {
        CROFAI_API_KEY: "secret-crofai-key",
        OPENAI_API_KEY: "secret-openai-key",
      },
    });

    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain("secret-crofai-key");
    expect(serialized).not.toContain("secret-openai-key");
    expect(catalog.providers.find((provider) => provider.id === "crofai")?.credential.configured).toBe(true);
    expect(catalog.providers.find((provider) => provider.id === "openai")?.credential).toMatchObject({
      kind: "env",
      configured: true,
      requiredEnvVars: ["OPENAI_API_KEY"],
    });
  });

  it("rereads .env.harness on each default catalog build", () => {
    writeFileSync(join(envDir, "pnpm-workspace.yaml"), "packages: []\n");
    writeFileSync(join(envDir, ".env.harness"), "CROFAI_API_KEY=secret-from-file\n");
    process.chdir(envDir);

    const catalog = buildModelCatalog();

    expect(catalog.providers.find((provider) => provider.id === "crofai")?.credential.configured).toBe(true);
    expect(JSON.stringify(catalog)).not.toContain("secret-from-file");
  });
});
