# Contributing

Thanks for taking a look at pi-harness. This project is a local multi-agent
coding harness, so changes should keep the workflow inspectable, reversible,
and safe for real repositories.

## Setup

Use Node 22+ and pnpm 9.12:

```bash
corepack enable
pnpm install
pnpm dev
```

Copy `.env.example` and `.env.harness.example` only for local development. Do
not commit real secrets.

## Development Checks

Run focused checks first, then the full suite before opening a PR:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm audit:maintainability
```

Dashboard E2E tests:

```bash
pnpm --filter @pi-harness/dashboard test:e2e
```

## Pull Requests

Please include:

- What changed and why.
- Validation commands you ran.
- Screenshots or Playwright evidence for visible dashboard changes.
- Notes for state layout changes, new environment variables, or infrastructure
  changes.

Keep commits short, imperative, and scoped when useful, for example
`fix(orchestrator): handle missing task metadata`.

## Project Boundaries

- Keep dashboard UI calm and operational; color should signal status, not
  decorate.
- Do not add speculative endpoints, config knobs, or abstractions.
- Validate data at trust boundaries and keep internal domain types explicit.
- Keep generated state, local worktrees, and real credentials out of git.
