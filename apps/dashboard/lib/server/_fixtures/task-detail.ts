import "server-only";
import type { AgentEvent, BrainstormArtifact, Run, Task } from "@pi-harness/shared";
import type {
  MockSubagent,
  MockFileTouched,
  MockRunHistoryEntry,
  MockDeepLinks,
  MockPlan,
} from "@/types/mocks";

const TASK_ID = "T-093";

const NOW = new Date("2026-05-09T14:23:00Z");
const fromMinutesAgo = (m: number, s = 0): Date =>
  new Date(NOW.getTime() - m * 60_000 - s * 1000);

export const MOCK_TASK: Task = {
  id: TASK_ID,
  title: "Auth redirect after login on mobile",
  description:
    "Fix the iOS-safari login flow so users land back on the page they were trying to reach, not on /login. Bug only reproduces in mobile safari due to ITP cookie blocking.",
  status: "executing",
  workflow: "backend-feature",
  worktreePath: ".harness/runs/r_8f3a/",
  branchName: "pi/T-093",
  retryCount: 2,
  phaseModels: {},
  createdAt: fromMinutesAgo(21, 2),
  updatedAt: fromMinutesAgo(0, 18),
};

export const MOCK_RUNS: Run[] = [
  {
    id: "r_8f3a91c2",
    taskId: TASK_ID,
    phase: "brainstorm",
    status: "succeeded",
    startedAt: fromMinutesAgo(20, 49),
    endedAt: fromMinutesAgo(18, 35),
    error: null,
    costUsd: 0.04,
    inputTokens: 3200,
    outputTokens: 820,
    piSessionPath: null,
  },
  {
    id: "r_8f3a91c2",
    taskId: TASK_ID,
    phase: "plan",
    status: "succeeded",
    startedAt: fromMinutesAgo(18, 35),
    endedAt: fromMinutesAgo(17, 48),
    error: null,
    costUsd: 0.06,
    inputTokens: 4800,
    outputTokens: 1240,
    piSessionPath: null,
  },
  {
    id: "r_8f3a91c2",
    taskId: TASK_ID,
    phase: "code",
    status: "running",
    startedAt: fromMinutesAgo(17, 47),
    endedAt: null,
    error: null,
    costUsd: 0.41,
    inputTokens: 24800,
    outputTokens: 6920,
    piSessionPath: null,
  },
];

const RUN_ID = MOCK_RUNS[0]!.id;

type AgentEventPayload = AgentEvent extends infer E
  ? E extends { id: string; runId: string; taskId: string; ts: Date }
    ? Omit<E, "id" | "runId" | "taskId" | "ts">
    : never
  : never;

const ev = (
  i: number,
  minutesAgo: number,
  secondsAgo: number,
  rest: AgentEventPayload,
): AgentEvent =>
  ({
    id: `e_${String(i).padStart(4, "0")}`,
    runId: RUN_ID,
    taskId: TASK_ID,
    ts: fromMinutesAgo(minutesAgo, secondsAgo),
    ...rest,
  }) as AgentEvent;

export const MOCK_EVENTS: AgentEvent[] = [
  ev(1, 21, 2, { kind: "phase_started", phase: "brainstorm" }),
  ev(2, 20, 49, { kind: "log", level: "info", text: "session opened · brainstorm-agent" }),
  ev(3, 20, 46, { kind: "tool_call", tool: "read_repo_layout", input: { dir: "src/auth" } }),
  ev(4, 20, 22, { kind: "tool_result", tool: "write_artifact", ok: true }),
  ev(5, 18, 35, { kind: "phase_ended", phase: "brainstorm", status: "succeeded" }),
  ev(6, 18, 34, { kind: "phase_started", phase: "plan" }),
  ev(7, 17, 48, { kind: "tool_result", tool: "write_artifact", ok: true }),
  ev(8, 17, 47, { kind: "phase_ended", phase: "plan", status: "succeeded" }),
  ev(9, 17, 47, { kind: "phase_started", phase: "code" }),
  ev(10, 17, 43, { kind: "tool_call", tool: "edit", input: { path: "src/auth/redirect.ts", added: 42, removed: 3 } }),
  ev(11, 17, 39, { kind: "tool_call", tool: "edit", input: { path: "src/auth/mobile-flow.ts", added: 18, removed: 0 } }),
  ev(12, 17, 35, { kind: "tool_call", tool: "edit", input: { path: "test/auth/redirect.test.ts", added: 84, removed: 12 } }),
  ev(13, 17, 29, { kind: "tool_result", tool: "vitest", ok: false }),
  ev(14, 17, 26, { kind: "message_delta", text: "analysing failures · 'redirects to /login on safari'" }),
  ev(15, 17, 22, { kind: "tool_call", tool: "edit", input: { path: "src/auth/redirect.ts", added: 6, removed: 2 } }),
  ev(16, 17, 18, { kind: "tool_result", tool: "vitest", ok: false }),
  ev(17, 17, 15, { kind: "tool_call", tool: "edit", input: { path: "src/auth/state.ts", added: 11, removed: 0 } }),
  ev(18, 17, 11, { kind: "log", level: "info", text: "test runner · running… test/auth/redirect.test.ts > restores deep link after oauth" }),
];

export const MOCK_SUBAGENTS: MockSubagent[] = [
  { name: "brainstorm-agent", status: "done", durationMs: 134_000 },
  { name: "plan-author", status: "done", durationMs: 47_000 },
  { name: "code-implementer", status: "active", durationMs: 17 * 60_000 + 47_000 },
  { name: "verification-author", status: "queued", durationMs: null },
  { name: "pr-author", status: "queued", durationMs: null },
];

export const MOCK_FILES_TOUCHED: MockFileTouched[] = [
  { path: "src/auth/redirect.ts", added: 48, removed: 5, state: "live" },
  { path: "src/auth/mobile-flow.ts", added: 18, removed: 0, state: "live" },
  { path: "src/auth/state.ts", added: 11, removed: 0, state: "live" },
  { path: "test/auth/redirect.test.ts", added: 84, removed: 12, state: "settled" },
  { path: "test/auth/mobile.test.ts", added: 38, removed: 0, state: "settled" },
  { path: "CHANGELOG.md", added: 2, removed: 0, state: "settled" },
];

export const MOCK_RUN_HISTORY: MockRunHistoryEntry[] = [
  { runId: "r_8f3a", label: "code · 19m", kind: "progress", age: "now", current: true },
  { runId: "r_71d4", label: "verify failed", kind: "blocked", age: "2h", current: false },
  { runId: "r_5a02", label: "code error", kind: "blocked", age: "3h", current: false },
];

export const MOCK_DEEP_LINKS: MockDeepLinks = {
  brainstorm: { available: true, href: `/tasks/${TASK_ID}/brainstorm` },
  plan: { available: true, href: `/tasks/${TASK_ID}/plan` },
  verify: { available: false, reason: "Code phase has not finished yet" },
};

const BRAINSTORM_BASE = new Date("2026-05-09T14:02:11Z");
const turnAt = (m: number, s: number): string =>
  new Date(BRAINSTORM_BASE.getTime() + m * 60_000 + s * 1000).toISOString();

export const MOCK_BRAINSTORM_ARTIFACT: BrainstormArtifact = {
  goal:
    "Fix the iOS-safari login flow so users land back on the page they were trying to reach, not on `/login`. Bug only reproduces in mobile safari due to ITP cookie blocking.",
  decisions: [
    "Preserve the user's pre-login URL across the OAuth round-trip — landing back on the dashboard is not acceptable.",
    "Stash the redirect URL in the signed OAuth `state` parameter, not in `sessionStorage` or a cookie. Safari ITP doesn't carry sessionStorage across top-level navigation.",
    "Symptom on iOS safari is repeated landing on `/login`, not a blank page. Test target is mobile safari only — desktop and iOS chrome are healthy.",
  ],
  openQuestions: [
    "Cap on round-trippable URL length, or accept anything? Long URLs in `state` approach the 2KB OAuth limit.",
    "Should iOS chrome be tested too, since it shares the WebKit engine?",
  ],
  suggestedWorkflow: "backend-feature",
  transcript: [
    {
      role: "agent",
      ts: turnAt(0, 3),
      text:
        "I read the auth flow in `src/auth/`. There are three places a redirect can happen: `routes/login.ts`, `state.ts`, and a guard in `middleware/session.ts`. The bug is likely in the last one. Before I scope, two things:\n\n1. On **mobile safari specifically**, what's the symptom — does the user land on `/login` repeatedly, or on a blank page?",
    },
    {
      role: "user",
      ts: turnAt(0, 20),
      text:
        "Lands on `/login` repeatedly. Only on iOS safari. Chrome on iOS is fine. Desktop fine.",
    },
    {
      role: "agent",
      ts: turnAt(0, 37),
      text:
        "iOS-safari-only narrows it. Most likely a cookie / storage issue — safari blocks third-party cookies in the OAuth flow, so the session token never round-trips back. Two scoping calls I need from you:\n\n2. Does the redirect need to **preserve the deep link** the user was trying to reach (e.g. `/r/abc`), or is landing on the dashboard fine?",
    },
    {
      role: "user",
      ts: turnAt(0, 51),
      text:
        "preserve deep link — the support tickets are about losing where they were.",
    },
    {
      role: "agent",
      ts: turnAt(1, 10),
      text:
        "3. For storage of the pre-login URL — `sessionStorage` is fine for desktop but it doesn't survive a top-level navigation in safari ITP. Two options:",
    },
    {
      role: "user",
      ts: turnAt(1, 27),
      text: "state param. We already sign it.",
    },
    {
      role: "agent",
      ts: turnAt(2, 1),
      text:
        "Got what I need. One thing I'm leaving as **open** for the plan author:\n\n> Should we cap the round-trippable URL length, or accept anything? Long URLs in `state` push us close to the 2KB OAuth limit when the provider re-emits.\n\nWriting the artifact now.",
    },
  ],
};

export const MOCK_PLAN: MockPlan = {
  taskId: TASK_ID,
  taskTitle: MOCK_TASK.title,
  phaseDurationLabel: "47s",
  authoredBy: "plan-author",
  approachParagraphs: [
    "The bug is iOS-safari-only because Safari's ITP drops the OAuth provider's cross-site cookie before the callback round-trips, so `session.ts` never sees the original `continue=` URL. Per **D2**, we'll round-trip the redirect target inside the signed OAuth `state` parameter — first-party, under our control, opaque to the provider.",
    "Encode `{ to, nonce, exp }`, sign with the existing HMAC key in `auth-secret.ts`, base64url-encode, send. On callback, verify the signature, check `exp < now + 5min`, redirect to `to` if it's same-origin; otherwise hard-fail to `/` with a logged warning.",
  ],
  fileChanges: [
    { op: "edit", path: "src/auth/redirect.ts", why: "encode + parse `state` param; replace sessionStorage path", delta: "+~50 −~5" },
    { op: "new", path: "src/auth/mobile-flow.ts", why: "isolated helper for the iOS-safari code path", delta: "+~20" },
    { op: "edit", path: "src/auth/state.ts", why: "expose `signRedirectState()` / `verifyRedirectState()`", delta: "+~12" },
    { op: "new", path: "test/auth/redirect.test.ts", why: "unit coverage for sign/verify + iOS-safari guard", delta: "+~85" },
    { op: "new", path: "test/auth/mobile.test.ts", why: "e2e walk through OAuth round-trip on mobile webkit", delta: "+~40" },
    { op: "edit", path: "CHANGELOG.md", why: "user-facing line for the fix", delta: "+1" },
  ],
  risks: [
    { level: "high", body: "**Open redirect.** If `verifyRedirectState()` doesn't check same-origin, a signed link from us could redirect to an attacker's domain. *Mitigation:* reject any `to` whose origin doesn't match `req.host`, fail closed to `/`." },
    { level: "normal", body: "**2KB `state` ceiling.** Some OAuth providers cap `state` at ~2KB. Long deep-link URLs could exceed this. See open question Q1 — plan-author defaults to truncating with a warning, plan reviewer can override." },
    { level: "normal", body: "**Replay window.** 5-minute `exp` is generous. If we tighten later, expired sessions during slow OAuth flows will redirect to root with no error UI." },
  ],
  openQuestions: [
    { id: "Q1", body: "Cap on the round-trippable URL length, or accept anything? Long URLs in `state` approach the OAuth 2KB limit. Plan-author has chosen to truncate to 1.5KB with a debug log; flip the toggle below to make this a hard reject instead." },
  ],
  scenarios: [
    { id: "S-024", kind: "unit", source: "library", name: "Auth redirect preserves deep-link query string", expression: 'redirectAfterLogin("/r?x=1#h") → "/r?x=1#h" · path = /r · hash kept', enabled: true },
    { id: "S-041", kind: "unit", source: "new", name: "signRedirectState rejects expired payloads", expression: "verifyRedirectState(token, now + 6min) → throws RedirectStateExpired", enabled: true },
    { id: "S-042", kind: "unit", source: "new", name: "verifyRedirectState rejects cross-origin `to`", expression: 'to = "https://evil.example/x" → falls back to / · logs warning', enabled: true },
    { id: "S-014", kind: "api", source: "library", name: "Login returns 200 + bearer token", expression: "POST /api/auth/login → 200 · body.token matches /^Bearer\\s\\w+/", enabled: true },
    { id: "S-043", kind: "api", source: "new", name: "/auth/callback redirects to encoded `to`", expression: "GET /auth/callback?state=<signed> → 302 · Location: /r/abc?x=1", enabled: true },
    { id: "S-033", kind: "visual", source: "library", name: "Login redirect · iOS safari viewport", expression: "playwright · webkit · 375 × 812 → baseline diff < 0.5%", enabled: true },
    { id: "S-029", kind: "visual", source: "library", name: "Empty state · new account dashboard", expression: "unrelated to this change · skipped for this run", enabled: false },
  ],
  gate: {
    state: "approved",
    enabledCount: 6,
    totalCount: 7,
    planRev: "a3",
    coderPickedUpAt: "14:03:26",
  },
};

export const MOCK_TASK_DETAIL = {
  task: MOCK_TASK,
  runs: MOCK_RUNS,
  events: MOCK_EVENTS,
  subagents: MOCK_SUBAGENTS,
  filesTouched: MOCK_FILES_TOUCHED,
  runHistory: MOCK_RUN_HISTORY,
  deepLinks: MOCK_DEEP_LINKS,
};

// Bundle fixture for the new brainstorm contract (design.md + spec.md +
// JSONL events). Used when the orchestrator is unreachable so the page
// renders against representative live data.
import type { BrainstormBundle } from "@/lib/api";

export const MOCK_BRAINSTORM_BUNDLE: BrainstormBundle = {
  gate: "running",
  status: "brainstorming",
  design: {
    fm: {
      task: "T-001",
      kind: "design",
      parent: null,
      status: "draft",
      branch: "pi/T-001",
      last_updated: "2026-05-09T12:00:00.000Z",
      last_updated_by: "brainstorm-agent",
    },
    body: "# Design\n\n## Goals\n\n_Awaiting first answer..._\n",
  },
  spec: {
    fm: {
      task: "T-001",
      kind: "spec",
      parent: "design.md",
      status: "draft",
      branch: "pi/T-001",
      last_updated: "2026-05-09T12:00:00.000Z",
      last_updated_by: "brainstorm-agent",
    },
    body: "# Spec\n\n_Awaiting acceptance answers..._\n",
  },
  events: [
    {
      kind: "brainstorm_system",
      ts: "2026-05-09T12:00:01.000Z",
      systemKind: "probe_complete",
    },
    {
      kind: "brainstorm_question",
      ts: "2026-05-09T12:00:02.000Z",
      questionId: "q_scope",
      prompt: "What's the intended scope?",
      options: [
        { id: "narrow", label: "Single area, minimal blast radius", recommended: true, evidence: ["src/index.ts:1"] },
        { id: "broad", label: "Cross-cutting refactor", recommended: false, evidence: [] },
        { id: "spike", label: "Spike to learn the shape, then split", recommended: false, evidence: [] },
      ],
      sectionTarget: { artifact: "design", section: "Goals" },
      batchId: "b_mock_1",
    },
  ],
};

export const MOCK_TASK_LIST = {
  tasks: [MOCK_TASK],
  counts: {
    backlog: 0,
    brainstorming: 0,
    planning: 0,
    executing: 1,
    verifying: 0,
    verification_failed: 1,
    ready_to_ship: 0,
    done: 12,
    cancelled: 0,
  } as Record<string, number>,
};
