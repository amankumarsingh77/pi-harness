# Plan Page Polish — Design Doc

> **Scope this round (per user):** micro-interactions + state clarity, no full redesigns.
> Priority surfaces: **Agent dossier modal** and **Artifacts + execution map**.
> Aesthetic is locked: Linear-style, calm/monochrome, color reserved for status only
> (`--st-*` tokens). Polish = motion + state legibility within the existing system, not a
> new visual language.

## Problem

The live plan page (`PlanPageLive → PlanBody → PlanCanvasConsole`) is functionally complete
and information-dense, but it reads as *static*. Every surface renders the right data, yet:

- Modals **pop** in/out with no transition and don't trap or restore focus.
- State that changes over a run (cost, tokens, running agents, findings arriving) **snaps**
  instead of signalling "this just updated / this is live".
- Several interactions have **invisible rules** — e.g. the request-changes Send button is
  disabled until the comment is ≥10 chars, but nothing tells the user why.
- Hover/active feedback is inconsistent across otherwise-identical button patterns.

None of this is a bug. It's the gap between "works" and "feels considered". This doc covers
the two surfaces the user prioritised; the header/sidebar/canvas get a follow-up pass.

## Context

- Single component file: `apps/dashboard/components/plan/plan-canvas-console.tsx` (~1450 lines)
  holds the header, sidebar, canvas, both modals, and all helpers.
- Execution map is its own file: `apps/dashboard/components/plan/execution-phases-preview.tsx`.
- Design tokens + the only existing animations live in `apps/dashboard/app/globals.css`:
  `plan-agent-node-running-blink`, `pulse-dot`, `tick-anim`, `typing-dot`, `scroll-hide`,
  and a `prefers-reduced-motion` guard. **Reuse these; don't invent parallel keyframes.**
- Status palette (`--st-progress` blue, `--st-review` amber, `--st-done` green,
  `--st-blocked` red) is the *only* sanctioned color. Everything else is monochrome lines
  on `--bg`/`--card`.

## Use-case map (the two priority surfaces)

### A. Agent dossier modal (`AgentDetailModal`)
Deep-dive into one agent. Opened from sidebar or a canvas node. Six tabs:
- **overview** — metric tiles (runtime/cost/tokens), assignment/execution info rows, activity
  counts, tools, error. Has a *live* path: `useNowMs` ticks runtime while the agent runs.
- **findings** — the agent's returned markdown body, or empty.
- **logs** — live tool-call rows (expandable) + lifecycle list.
- **tools / prompt / raw events** — registered tools, prompt sent, raw JSON.

*Who/when:* debugging or auditing a single agent mid- or post-run.

### B. Artifacts modal (`PlanArtifactsModal`) + Execution map (`ExecutionPhasesPreview`)
Read what planning produced. Left = file navigator (`plan.md`, phase plans, execution-dag,
scenarios, blast-radius, raw bundle); right = toolbar + rendered body. The execution-dag tab
renders the **execution map**: phase columns + a node inspector showing each task's contract
(lane/kind/safety/depends/assertion).

*Who/when:* reviewing the plan before making the approve/request-changes call.

## Requirements

Functional / behavioural:

- **F1** — When a dossier or artifacts modal opens, it animates in (fade + subtle scale/rise);
  on close it animates out. Honors `prefers-reduced-motion` (instant, no transform).
- **F2** — Open modals trap Tab focus within the dialog and restore focus to the trigger
  element on close. Escape still closes (already implemented).
- **F3** — In `OverviewTab`, the live runtime value (and the "so far" metric tiles) carry a
  visible *live* affordance (pulsing dot) while `node.status === "running"`, and lose it when
  the agent ends — so a glance distinguishes a live figure from a final one.
- **F4** — `PlanApprovalActions` request-changes textarea shows a live character counter and a
  reason for the disabled Send state ("10 char minimum"), and supports ⌘/Ctrl+Enter to send.
- **F5** — Approve / Send-revision buttons show an in-flight (pending) state — spinner +
  label change — driven by the existing `useTransition` `pending` flag, not a new one.
- **F6** — Tab switches in both modals' side rails get an active-press + a smooth indicator
  transition (the inset accent bar slides/fades rather than hard-cutting between tabs).
- **F7** — Execution-map `NodeCard` selection and `NodeInspector` reveal animate: selecting a
  node cross-fades the inspector contents; the selected card gets a clear, calm selected state
  consistent with the rest of the page (currently a one-off `bg-st-progress/[0.07]`).
- **F8** — Findings/logs that arrive live (findings body appears, new tool-call rows append)
  get a brief one-shot highlight so the user notices new content without a layout jump.

Non-functional:

- **NF1** — No new color outside `--st-*`. New emphasis comes from line-weight, opacity, and
  motion only.
- **NF2** — Every animation respects `prefers-reduced-motion`; transforms/opacity only (no
  layout-thrashing properties) to keep 60fps on the canvas page.
- **NF3** — No new runtime deps. Motion via CSS (Tailwind `transition`/`animate-*` + a few
  shared keyframes in `globals.css`). The repo has no Motion/Framer; don't add it.
- **NF4** — Information density preserved or increased — no string becomes decorative. The
  character counter, "live" affordance, and disabled-reason are all *real* info.

Edge cases:

- **E1** — Reduced motion: all of F1/F3/F6/F7/F8 degrade to instant final state.
- **E2** — Agent transitions running→ended while its dossier is open: the live affordance must
  drop and the runtime freeze at the final value (the `useNowMs(enabled)` gate already handles
  the number; the affordance must follow the same `isRunning` flag).
- **E3** — Rapid tab switching must not stack/queue animations (use CSS state, not JS timers
  where possible; for one-shot highlights key off content identity, not a setInterval).
- **E4** — Focus trap must not break when the modal has zero focusable children on a given tab
  (e.g. an empty findings panel) — fall back to focusing the dialog container.
- **E5** — Long content + animated open: the scale/rise transform must not cause a scroll
  flash; animate the backdrop opacity and a wrapper, not the scrollable body.

## Architectural decisions

- **AD1 — Motion lives in CSS, invoked via class.** Add a small set of shared keyframes/utility
  classes to `globals.css` (`modal-enter`, `flash-once`, reuse `pulse-dot`). Components toggle
  classes. Rationale: matches existing pattern (all current animation is CSS), zero deps, free
  reduced-motion handling in one media query block.
- **AD2 — Focus trap is a tiny local hook, not a library.** Add `useFocusTrap(ref, onClose)`
  beside the existing `useEscapeToClose`. Rationale: one modal shell, NF3 forbids deps, scope
  is small (Tab/Shift-Tab cycle + restore). Both modals already route through `ModalShell` —
  wire it there once.
- **AD3 — Exit animation needs a mount delay.** `ModalShell` currently unmounts instantly on
  `onClose`. To animate out, introduce a local "closing" state that plays the exit class then
  calls the real `onClose` on `animationend` (with a timeout fallback). Keep this *inside*
  `ModalShell` so callers are unchanged.
- **AD4 — "Live" affordance is derived, never stored.** Drive F3 off the same `isRunning`
  boolean already computed in `OverviewTab`; the pulsing dot is a presentational sibling to the
  value. No new state, no new event.
- **AD5 — One-shot highlight keys off content identity.** For F8, a row/body flashes when its
  identity first appears (e.g. `key`-based remount or a "seen ids" set), so it fires once and
  never re-fires on re-render or reduced motion.

## Approaches considered

Only one approach is viable given the constraints (CSS-only motion, no deps, locked tokens).
The single real fork is the modal enter/exit:

- **Chosen — CSS class + closing-state in `ModalShell`** (AD1/AD3). Centralised, callers
  unchanged, reduced-motion free.
- **Why not a portal/animation library** (Radix/Framer): NF3 forbids new deps for what is a
  ~30-line CSS + state change.
- **Why not animate at each call site:** duplicates the closing-state dance in two modals and
  drifts; `ModalShell` is the right seam.

## Risks & mitigations

- **R1 — Exit animation swallows close if `animationend` never fires** (interrupted, reduced
  motion). *Mitigation:* timeout fallback that force-calls `onClose`; under reduced motion skip
  the delay entirely.
- **R2 — Focus trap fights ReactFlow / browser shortcuts.** *Mitigation:* scope listeners to
  the dialog node, only intercept Tab; leave all other keys alone.
- **R3 — Over-animation makes the dense page feel busy** (violates the calm aesthetic).
  *Mitigation:* durations ≤180ms, opacity/transform only, no looping animation except the
  already-sanctioned running pulse; review against the Linear-calm bar before shipping.

## What this does NOT do

- No header / sidebar / canvas-node polish this round (follow-up pass).
- No layout, density, or information-architecture changes to any surface.
- No new colors, fonts, or tokens.
- No backend / SSE / event-shape changes — purely presentational.
- No new dependencies.

## Open questions

- **OQ1 — Modal exit animation: keep or cut?** It's the one piece with real complexity
  (closing-state + `animationend`). If the calm bar makes an exit transition feel like too
  much, enter-only (instant close) is a clean subset. Recommendation: ship enter+exit but make
  exit trivially removable.
