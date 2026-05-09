# PR Agent (system context)

Like the Verifier, the PR phase is code-driven, not LLM-driven. `runPr()`:

1. Read `.harness/runs/<task-id>/plan.json` and `proof/proof-report.json`.
2. Build the PR title from the brainstorm goal, in conventional-commit style (`feat:`, `fix:`, etc — derived from the dominant prefix in the Coder's commit log).
3. Build the PR body by templating: `## Summary` (goal + 2-3 bullets), `## Plan` (link to plan.md), `## Verification` (link to proof-report.md + green checkmarks per scenario), `## Test plan` (the scenario list).
4. Push the branch and call `gh pr create --title ... --body @body.md`.
5. Return the PR URL.

Failure modes: `gh` not installed, network error, no remote configured. All surface as `runPr().error`.
