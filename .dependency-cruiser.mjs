export default {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "packages-do-not-import-apps",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "shared-stays-runtime-agnostic",
      severity: "error",
      from: { path: "^packages/shared/" },
      to: {
        path: "^(apps/|packages/(db|pi-bridge)/)",
      },
    },
    {
      name: "dashboard-client-does-not-import-server-runtime",
      severity: "error",
      from: {
        path: "^apps/dashboard/(components|lib/client|lib/(?!server))",
      },
      to: {
        path: "^(apps/orchestrator/|packages/(db|pi-bridge)/|apps/dashboard/lib/server/)",
      },
    },
    {
      name: "no-orphans-without-entrypoint",
      severity: "error",
      from: {
        orphan: true,
        path: "^(apps|packages|subagents)/",
        pathNot:
          "(^apps/dashboard/app/.*(page|layout|loading|error|not-found|route)\\.tsx?$|^apps/dashboard/(next|playwright|postcss|vitest)\\.config\\.|^apps/dashboard/test/setup\\.ts$|^apps/orchestrator/src/index\\.ts$|^apps/orchestrator/vitest.*\\.config\\.ts$|^packages/.*/src/index\\.ts$|^packages/db/(drizzle|vitest)\\.config\\.ts$|^subagents/(index|registry)\\.ts$|\\.test\\.tsx?$|\\.spec\\.tsx?$|/test/|/e2e/)",
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules|\\.turbo|\\.worktrees|\\.harness|\\.next|dist|coverage|\\.reports|test-results|subagents/_vendored|packages/db/migrations",
    },
    exclude: {
      path: "\\.d\\.ts$|\\.tsbuildinfo$",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.depcruise.json",
    },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "types", "default", "node"],
    },
  },
};
