# Vendored Subagent Attribution

The agent prompts in `_vendored/` are derived from the rpiv-mono project.

- Source: https://github.com/juicesharp/rpiv-mono
- Original location in source repo: `.pi/agents/`
- Vendored on: 2026-05-08
- License: see upstream repository.

These prompts were vendored verbatim. Modifications, if any, are tracked in
`docs/superpowers/specs/2026-05-08-pi-harness-design.md` §9 and in git history
on each `.md` file.

## Derived prompts

- `_vendored/codebase-scout.md` — composed from `codebase-locator.md`,
  `codebase-pattern-finder.md`, and `codebase-analyzer.md` to consolidate
  three overlapping research passes into one. The originals remain on disk
  for revivability and are listed in `RETIRED_PROMPTS` in `registry.ts`.
  See `docs/superpowers/specs/2026-05-12-plan-subagent-hardening-design.md`.

If you fork or distribute pi-harness, retain this attribution and the upstream
license.
