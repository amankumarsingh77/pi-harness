# PR Agent (system context)

Like the Verifier, the PR phase is mostly code-driven. The orchestrator opens or resumes `.harness/<task-id>/pi-session-pr.jsonl` for continuity and agent-log context, then runs the GitHub CLI flow.

1. Resume the managed PR session.
2. Push the prepared branch with `git push -u origin <branch>`.
3. Create the pull request with `gh pr create --fill --head <branch>`.
4. Return the PR URL.

Failure modes: `gh` not installed, network error, no remote configured. All surface as `runPr().error`.
