# Repository Guidelines

## Project Structure & Module Organization

This is a pnpm/Turbo monorepo for a multi-agent coding harness. Application code lives in `apps/`: `apps/dashboard` is the Next.js UI and `apps/orchestrator` is the Fastify runner service. Shared libraries live in `packages/`: `shared` contains schemas and types, and `pi-bridge` wraps pi.dev integration. Agent prompts and registry code live in `subagents/`. Infrastructure files are under `infra/`, with optional local services in `compose.yml`.

Tests are colocated by package: `*.test.ts` or `*.test.tsx` in `src/`, `test/`, and `apps/dashboard/test/`. Browser tests are in `apps/dashboard/e2e/`.

## Build, Test, and Development Commands

Use Node 22+ and pnpm 9.12:

```bash
nvm use
corepack enable
pnpm install
```

- `pnpm dev`: starts dashboard and orchestrator through Turbo.
- `pnpm build`: builds all workspaces.
- `pnpm test`: runs all Vitest suites through Turbo.
- `pnpm typecheck`: runs `tsc --noEmit` across workspaces.
- `pnpm --filter @pi-harness/dashboard test:e2e`: runs Playwright dashboard tests.
- `pnpm infra:up` / `pnpm infra:down`: starts or stops optional local SearXNG.

## Coding Style & Naming Conventions

Code is TypeScript-first with strict settings from `tsconfig.base.json`, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Prefer explicit domain types and Zod schemas. Use workspace exports such as `@pi-harness/shared` rather than deep relative imports across packages.

Follow local naming patterns: React components use PascalCase, hooks use `use*`, test files use `*.test.ts(x)`, and package source entry points are `src/index.ts`. No formatter or real lint rule is currently configured; keep edits consistent with nearby code.

## Testing Guidelines

Vitest is the default unit and integration test runner. Dashboard component tests use Testing Library with `happy-dom`; E2E tests use Playwright. Add or update tests when changing schemas, persistence, orchestration behavior, API routes, or UI workflows. Run targeted package tests first, then `pnpm test` and `pnpm typecheck`.

## Commit & Pull Request Guidelines

Recent history uses conventional-style commits such as `feat(dashboard): add raw plan console` and merge commits from pull requests. Keep commit subjects short, imperative, and scoped when useful, for example `fix(orchestrator): handle missing task metadata`.

Pull requests should describe the change, list validation commands, link related issues, and include screenshots or Playwright evidence for visible dashboard changes. Call out state layout changes, environment variables, and infrastructure impacts.

## Security & Configuration Tips

Copy `.env.example` and `.env.harness.example` for local setup. Do not commit secrets. Use local SearXNG with `PI_WEB_PROVIDER=searxng`, and set `SEARXNG_SECRET` beyond local development.

## Pi Agent Implementation Docs

Before asserting pi-agent behavior or changing pi-agent integration code, locate and consult the installed `@mariozechner/pi-coding-agent` docs. Do not rely on a hard-coded global install path.

Find the package root with one of these commands:

```bash
npm root -g
npm explore -g @mariozechner/pi-coding-agent -- pwd
node -e "console.log(require.resolve('@mariozechner/pi-coding-agent/package.json'))"
```

If it is installed locally instead of globally, use `pnpm why @mariozechner/pi-coding-agent` or `find node_modules -path '*/@mariozechner/pi-coding-agent/package.json'`.

Use this map:

- `README.md` and `docs/index.md`: package overview and navigation.
- `docs/sdk.md`: embedding pi in Node.js, `createAgentSession()`, `AgentSession`, `createAgentSessionRuntime()`, prompting, event subscriptions, session replacement, and compaction.
- `docs/extensions.md`: extension factories, custom tools, commands, lifecycle events, UI hooks, state, and auto-discovery paths.
- `docs/custom-provider.md`: provider registration, model definitions, API keys, base URLs, OAuth, and custom streaming APIs.
- `docs/rpc.md`: JSONL stdin/stdout protocol for subprocess control, commands, streaming behavior, and state commands.
- `docs/json.md`: print-mode JSON event stream and event/message shape.
- `docs/session-format.md` and `docs/sessions.md`: persisted session JSONL format, branching, resume, and tree navigation.
- `docs/settings.md`, `docs/models.md`, and `docs/providers.md`: configuration, model registry, and built-in provider behavior.
- `examples/sdk/` and `examples/extensions/`: working integration and extension examples.
- `dist/index.d.ts`: authoritative exported TypeScript API when docs are ambiguous.

For repo code, pi integration currently centers on `packages/pi-bridge/` and orchestrator call sites. Verify assumptions against the docs above before modifying those paths.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
