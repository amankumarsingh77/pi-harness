# Verification Stubs — general-codebase-chat (from library-probe)

These VS-0 scenarios are the verified library probes. `functional-verify` re-runs
them at the end of the pipeline to confirm the live dependency still works.

### VS-0-crofai-chat-roundtrip: Library probe — pi-bridge + CrofAI streaming round-trip
**Type:** api
**Run:** `set -a; source "$(dirname "$(git rev-parse --git-common-dir)")/.env.harness"; set +a; node .harness/general-codebase-chat/probes/crofai/probe-chat-roundtrip.mjs`
**Expected:** exit 0; stdout JSON has `sawDelta: true` and `sawTurnEnd: true`; a `turn_end` usage object with `outputTokens > 0`.
**Why it matters:** This is the exact seam the chat feature streams through
(`createAgentSession` → `prompt` → `message_delta`/`turn_end`). If CrofAI dies
between now and PR, this catches it before the feature is declared done.
