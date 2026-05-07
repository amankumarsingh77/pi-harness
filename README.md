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

## Dev loop

```bash
pnpm test       # all packages
pnpm typecheck  # all packages
pnpm build      # all packages
```
