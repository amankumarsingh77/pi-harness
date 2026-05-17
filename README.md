# pi-harness

Multi-agent coding harness built on pi.dev. See `docs/superpowers/specs/2026-05-08-pi-harness-design.md`.

## Setup In Your Project

```bash
npm install -g @pi-harness/cli
pi-harness init
pi-harness dev
```

You can also run without a global install:

```bash
npx @pi-harness/cli init
npx @pi-harness/cli dev
```

`init` must be run inside an existing git repository. It writes `harness.config.ts`,
`.env.harness.example`, `.harness/runtime/compose.yml`, `.harness/README.md`, and
adds `.harness/` to `.gitignore`. It prefers Podman and records Docker only when
Podman is unavailable.

Copy `.env.harness.example` to `.env.harness` and add provider keys before
starting real agent runs. The default phase config expects `CROFAI_API_KEY`.

`dev` runs `doctor`, starts local Postgres through the generated compose file,
applies migrations, starts the orchestrator, and opens the dashboard at
`http://localhost:3000`. Agent work runs in per-task worktrees at
`.harness/worktrees/<taskId>` on branches named `pi/<taskId>`.

## Local Development

For contributors working on this monorepo:

```bash
corepack enable
pnpm install
pnpm db:up
pnpm db:migrate
pnpm dev

pnpm test       # all packages
pnpm typecheck  # all packages
pnpm build      # all packages
```

## Troubleshooting

- **Missing Podman:** install/start Podman, or install Docker and rerun `pi-harness init`.
- **Missing API key:** copy `.env.harness.example` to `.env.harness` and fill `CROFAI_API_KEY` or configure another provider.
- **Port conflict:** set `dashboardPort`, `orchestratorPort`, or `databaseUrl` in `harness.config.ts`.
- **Non-main base branch:** edit `baseBranch` in `harness.config.ts`; worktrees are created from that branch.
- **Dry setup check:** run `pi-harness dev --check-only` to validate config without starting services.
