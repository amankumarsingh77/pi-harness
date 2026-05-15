# pi-harness

Multi-agent coding harness built on pi.dev. See `docs/superpowers/specs/2026-05-08-pi-harness-design.md`.

## Setup

```bash
nvm use
corepack enable
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
```

Brainstorm web research uses `pi_web_search` and `pi_web_fetch`. TinyFish is the
default provider; set `TINYFISH_API_KEY` in `.env.harness` to enable hosted
search/fetch.

For local fallback, set `PI_WEB_PROVIDER=searxng` and run `pnpm search:up`.
That starts SearXNG at `http://localhost:8888`; override with `SEARXNG_URL` in
`.env.harness`. Public SearXNG instances also require
`SEARXNG_ALLOW_PUBLIC=true` and are best-effort because they may disable JSON or
rate-limit automation. The local compose setup also starts Valkey for SearXNG's
limiter and stores SearXNG cache data in a named volume. Local/private network
clients are passlisted in SearXNG's limiter so harness automation is not blocked
as bot traffic. Set `SEARXNG_SECRET` in `.env` for anything beyond local
development.

## Dev loop

```bash
pnpm test       # all packages
pnpm typecheck  # all packages
pnpm build      # all packages
```
