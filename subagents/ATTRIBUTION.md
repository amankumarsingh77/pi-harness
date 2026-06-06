# Subagent Prompt Attribution

Some prompt material under `prompts/` is derived from the rpiv-mono project.

- Source: https://github.com/juicesharp/rpiv-mono
- Original location in source repo: `.pi/agents/`
- Vendored on: 2026-05-08
- License: see upstream repository.

These prompts have since been adapted for pi-harness tool contracts and stored
by role:

- `prompts/phase/`: live phase-driver prompts maintained by pi-harness.
- `prompts/research/`: live research prompts, including derived rpiv-mono work.
- `prompts/audit/`: live audit prompts.

Modifications are tracked in `docs/superpowers/specs/2026-05-08-pi-harness-design.md`
§9 and in git history on each `.md` file.

## Derived prompts

- `prompts/research/codebase-scout.md` — composed from `codebase-locator.md`,
  `codebase-pattern-finder.md`, and `codebase-analyzer.md` to consolidate
  three overlapping research passes into one. The originals are retained in
  git history for attribution and recovery, but are no longer shipped as active
  or retired prompt files.
  See `docs/superpowers/specs/2026-05-12-plan-subagent-hardening-design.md`.

If you fork or distribute pi-harness, retain this attribution and the upstream
license.
