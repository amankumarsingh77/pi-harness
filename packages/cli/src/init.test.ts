import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeHarnessProjectConfig } from "@pi-harness/shared";
import { createInitPlan, renderComposeFile, renderHarnessConfig } from "./init.js";

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-harness-cli-"));
  await mkdir(join(dir, ".git"));
  return dir;
}

describe("createInitPlan", () => {
  it("refuses to initialize outside a git repository", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-harness-cli-"));
    try {
      await expect(
        createInitPlan({
          cwd: dir,
          env: {},
          execFile: async () => ({ ok: false, stdout: "", stderr: "not git" }),
        }),
      ).resolves.toMatchObject({ ok: false, error: "not_git_repo" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("chooses podman before docker and writes project-local setup", async () => {
    const dir = await tempProject();
    try {
      await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: {} }));
      const plan = await createInitPlan({
        cwd: dir,
        env: {},
        execFile: async (cmd, args) => {
          if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
            return { ok: true, stdout: `${dir}\n`, stderr: "" };
          }
          if (cmd === "git" && args.join(" ") === "branch --show-current") {
            return { ok: true, stdout: "trunk\n", stderr: "" };
          }
          if (cmd === "podman" && args[0] === "--version") {
            return { ok: true, stdout: "podman version 5\n", stderr: "" };
          }
          return { ok: false, stdout: "", stderr: "missing" };
        },
      });

      expect(plan).toMatchObject({
        ok: true,
        config: {
          repoRoot: dir,
          baseBranch: "trunk",
          containerRuntime: "podman",
          worktreesDir: join(dir, ".harness", "worktrees"),
        },
      });
      if (!plan.ok) return;
      expect(plan.files.map((file) => file.path).sort()).toEqual([
        ".env.harness.example",
        ".gitignore",
        ".harness/README.md",
        ".harness/runtime/compose.yml",
        "harness.config.ts",
        "package.json",
      ]);
      const packageJson = plan.files.find((file) => file.path === "package.json");
      expect(packageJson ? JSON.parse(packageJson.content) : null).toMatchObject({
        scripts: { "pi-harness": "pi-harness" },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to docker when podman is unavailable", async () => {
    const dir = await tempProject();
    try {
      const plan = await createInitPlan({
        cwd: dir,
        env: {},
        execFile: async (cmd, args) => {
          if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
            return { ok: true, stdout: `${dir}\n`, stderr: "" };
          }
          if (cmd === "git" && args.join(" ") === "branch --show-current") {
            return { ok: true, stdout: "main\n", stderr: "" };
          }
          if (cmd === "docker" && args[0] === "--version") {
            return { ok: true, stdout: "Docker version 27\n", stderr: "" };
          }
          return { ok: false, stdout: "", stderr: "missing" };
        },
      });

      expect(plan).toMatchObject({
        ok: true,
        config: { containerRuntime: "docker" },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("renders a TS config and compose file from the chosen config", () => {
    const config = mergeHarnessProjectConfig({
      repoRoot: "/repo",
      baseBranch: "trunk",
    });
    expect(renderHarnessConfig(config)).not.toContain("@pi-harness/shared");
    expect(renderHarnessConfig(config)).not.toContain("databaseUrl");
    expect(renderHarnessConfig(config)).toContain("export default {");
    expect(renderHarnessConfig(config)).toContain("baseBranch: \"trunk\"");
    expect(renderComposeFile(config)).not.toContain("postgres");
  });

  it("does not generate retired Graphify config or env defaults", async () => {
    const dir = await tempProject();
    try {
      const plan = await createInitPlan({
        cwd: dir,
        env: {},
        execFile: async (cmd, args) => {
          if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
            return { ok: true, stdout: `${dir}\n`, stderr: "" };
          }
          if (cmd === "git" && args.join(" ") === "symbolic-ref --short HEAD") {
            return { ok: true, stdout: "main\n", stderr: "" };
          }
          if (cmd === "podman" && args[0] === "--version") {
            return { ok: true, stdout: "podman version 5\n", stderr: "" };
          }
          return { ok: false, stdout: "", stderr: "missing" };
        },
      });

      expect(plan.ok).toBe(true);
      if (!plan.ok) return;
      expect(plan.files.find((file) => file.path === "harness.config.ts")?.content).not.toContain("graphify");
      expect(plan.files.find((file) => file.path === ".env.harness.example")?.content).not.toContain("GRAPHIFY_");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
