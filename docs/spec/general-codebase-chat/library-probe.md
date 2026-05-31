# Library Probe — general-codebase-chat

> **Run at:** 2026-05-30
> **Verdict:** PASS

## Context

This feature introduces **no new third-party libraries** — it composes existing,
already-trusted in-repo packages (`@pi-harness/pi-bridge`, Fastify SSE,
`EventSource`, `@tanstack/react-query`, `react-markdown`). The only dependency
whose health is a *live external service* — and therefore the only thing worth
probing — is the **pi AI SDK inference provider (CrofAI)** reached through
`pi-bridge`'s `createAgentSession`. That is the seam the chat streams through, so
the probe exercises it directly.

## Summary

| Library | Health | Smoke | Final |
|---|---|---|---|
| crofai (via pi-bridge `createAgentSession`) | live — HTTP 200 on `/v1/models` | VERIFIED — `message_delta` + `turn_end` streamed | **SELECTED** |
| anthropic (fallback) | n/a | not probed — `ANTHROPIC_API_KEY` absent in `.env.harness` | available-if-keyed |
| Fastify SSE / EventSource / react-query / react-markdown | internal/standard | n/a — no external service | trusted |

## Selected

- **crofai** (`deepseek-v3.2` used for the probe; any CrofAI model works) for the
  chat inference round-trip.
- Evidence: `.harness/general-codebase-chat/probes/crofai/probe.log`
  - `sawDelta: true`, `sawTurnEnd: true`, eventKinds `[message_delta, turn_end]`
  - real usage returned: 36 output tokens, **$0.0045** for the round-trip
  - exit 0

## Pivot Log

_None._ Primary dependency verified on first probe.

## Fallback Notes

- The fallback chain (CrofAI → Anthropic → picker error) is **user-driven at
  runtime** via the model picker in the UI, not a build-time pivot. Anthropic is
  unprobed only because no `ANTHROPIC_API_KEY` is configured; the picker will mark
  it as needing sign-in, which is the designed behavior.

## Setup Needed

- None. `CROFAI_API_KEY` is present in project-root `.env.harness` (gitignored,
  verified). To enable the Anthropic fallback later, add `ANTHROPIC_API_KEY` to
  `.env.harness`.

## Resolution

_Not escalated — primary verified._

<!-- LP:VERDICT:PASS -->
