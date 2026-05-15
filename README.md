# pi-harness

Multi-agent coding harness built on pi.dev. See `docs/superpowers/specs/2026-05-08-pi-harness-design.md`.

## Setup

```bash
nvm use
corepack enable
pnpm install
cp .env.example .env
pnpm db:up
pnpm search:up
pnpm db:migrate
```

`pnpm search:up` starts a local SearXNG instance for brainstorm web research at
`http://localhost:8888`. Override with `SEARXNG_URL` in `.env.harness`; public
instances also require `SEARXNG_ALLOW_PUBLIC=true` and are best-effort because
they may disable JSON or rate-limit automation. The local compose setup also
starts Valkey for SearXNG's limiter and stores SearXNG cache data in a named
volume. Local/private network clients are passlisted in SearXNG's limiter so
harness automation is not blocked as bot traffic. Set `SEARXNG_SECRET` in
`.env` for anything beyond local development.

## Dev loop

```bash
pnpm test       # all packages
pnpm typecheck  # all packages
pnpm build      # all packages
```
