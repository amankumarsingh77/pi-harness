# pi-harness Plan 3: Agent Fleet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stub prompts in Plan 2 with real, executable phase drivers (Brainstorm, Plan, Code, Verify, PR), author the three new subagents (`verification-author`, `proof-capture`, `screenshot-taker`), and wire the Planning Agent's 7-phase research pipeline (spec §7.1) so the orchestrator can drive a task from one-line ticket → green verification gate → opened PR.

**Architecture:** The "agent fleet" is a directory of structured Markdown prompt files plus a small TypeScript orchestration layer that knows how to (a) compose system prompts from those files, (b) fan out to the rpiv research subagents in parallel during planning, (c) persist phase artifacts to `.harness/runs/<task-id>/`, and (d) drive verification scenarios end-to-end with real Playwright + curl.

Three layers:
1. **Prompt files** (`subagents/ours/*.md` + `subagents/_vendored/*.md`). Markdown with YAML frontmatter — same shape as the rpiv-mono fleet. The frontmatter has `name`, `description`, `tools`, `isolated`. The body is the system prompt.
2. **Phase drivers** (`apps/orchestrator/src/agents/*.ts`). One file per phase. Each exports a `runPhase()` function that the orchestrator's run-loop calls. Drivers compose prompts, dispatch subagents via `pi-bridge.runSubagent`, and write artifacts.
3. **Artifact contracts** (`packages/shared/src/types/artifacts.ts`). Typed shapes for `BrainstormArtifact`, `PlanArtifact`, `ProofReport` so phase drivers and the dashboard agree on what "done" produces.

**Tech Stack:** TypeScript, `@pi-harness/pi-bridge`, `@pi-harness/subagents`, `playwright` (in the verifier), `js-yaml` (parsing scenarios + frontmatter), `gh` CLI (PR agent), Vitest.

**Spec reference:** `docs/superpowers/specs/2026-05-08-pi-harness-design.md` — §7 Planning Agent (the core), §8 Verification gate, §9 agent fleet.

**Mock reference:** `docs/mocks/`:
- `brainstorm.html` — Brainstorm Agent's chat shape, "Emerging Spec" decisions/questions structure.
- `task-detail.html` — phase timeline + agent log (Plan 3 produces the events that fill it).
- `verification.html` — the proof panel's three columns (24/24 unit, 3/3 functional, visual screenshots) — Plan 3's Verifier Agent writes the data behind this.

**Density rule** (`memory/feedback_dashboard_density.md`): every value the dashboard renders must come from a real artifact. The phase drivers in this plan are responsible for producing those values: `cost · tokens · retries · phase budget %`, scenario pass/fail, file paths, branch names.

**Out of scope for this plan:** the dashboard UI itself (Plan 4), refactor/bugfix workflows (deferred to v2), the `mock-designer` subagent (deferred to v2 — UI workflow only).

---

## File Structure

This plan creates these files:

| Path | Responsibility |
|---|---|
| `subagents/ours/verification-author.md` | Drafts `verification.yaml` from plan + brainstorm |
| `subagents/ours/proof-capture.md` | Runs one scenario; writes its evidence slice |
| `subagents/ours/screenshot-taker.md` | Playwright screenshot helper |
| `subagents/index.ts` (modify) | Add `ours/` resolution; `OUR_AGENTS` constant |
| `subagents/test/loader.test.ts` (modify) | Cover ours/ resolution |
| `packages/shared/src/types/artifacts.ts` | `BrainstormArtifact`, `PlanArtifact`, `ProofReport` types |
| `packages/shared/src/index.ts` (modify) | Re-export artifacts |
| `packages/shared/src/schemas/artifacts.ts` | Zod schemas for the same |
| `packages/shared/test/artifacts.test.ts` | Schema parse tests |
| `apps/orchestrator/src/agents/brainstorm.ts` | Brainstorm Agent driver |
| `apps/orchestrator/src/agents/plan.ts` | Planning Agent driver — 7-phase pipeline |
| `apps/orchestrator/src/agents/plan-fanout.ts` | Helper: dispatch the parallel rpiv subagents |
| `apps/orchestrator/src/agents/code.ts` | Coder Agent driver |
| `apps/orchestrator/src/agents/verify.ts` | Verifier Agent driver |
| `apps/orchestrator/src/agents/verify-runner.ts` | Scenario runner (api / ui / ui-visual) |
| `apps/orchestrator/src/agents/pr.ts` | PR Agent driver — gh + conventional commits |
| `apps/orchestrator/src/agents/artifacts-store.ts` | Read/write `.harness/runs/<id>/*` |
| `apps/orchestrator/src/agents/prompts/` | Markdown prompt files for the 5 phase drivers |
| `apps/orchestrator/src/agents/prompts/brainstorm.md` | Brainstorm system prompt |
| `apps/orchestrator/src/agents/prompts/plan.md` | Planning system prompt |
| `apps/orchestrator/src/agents/prompts/code.md` | Coder system prompt |
| `apps/orchestrator/src/agents/prompts/verify.md` | Verifier system prompt |
| `apps/orchestrator/src/agents/prompts/pr.md` | PR Agent system prompt |
| `apps/orchestrator/src/runner/phase-prompts.ts` (rewrite) | Replace stubs; load real prompts from `prompts/` |
| `apps/orchestrator/test/agents/brainstorm.test.ts` | Brainstorm driver test (mocked pi-bridge) |
| `apps/orchestrator/test/agents/plan-fanout.test.ts` | Fanout dispatches all required research subagents |
| `apps/orchestrator/test/agents/verify-runner.test.ts` | Scenario runner: api scenarios with mock HTTP |
| `apps/orchestrator/test/agents/verify-runner-ui.test.ts` | UI scenarios via Playwright on a static page |
| `apps/orchestrator/test/agents/pr.test.ts` | PR driver builds the right gh args (mocked exec) |
| `apps/orchestrator/test/agents/artifacts-store.test.ts` | Round-trip read/write to a tmp runs dir |

---

## Task 1: Artifact types + schemas

The contracts every phase driver writes against. Defining these first means each driver test can assert against a typed artifact instead of a free-form string blob.

**Files:**
- Create: `packages/shared/src/types/artifacts.ts`, `packages/shared/src/schemas/artifacts.ts`, `packages/shared/test/artifacts.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing test**

`packages/shared/test/artifacts.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import {
  BrainstormArtifactSchema,
  PlanArtifactSchema,
  ProofReportSchema,
} from "../src/schemas/artifacts.js";

describe("artifact schemas", () => {
  it("BrainstormArtifact requires goal + decisions[]", () => {
    expect(
      BrainstormArtifactSchema.parse({
        goal: "Retry webhooks bounded.",
        decisions: ["expo backoff", "5 max"],
        openQuestions: [],
        suggestedWorkflow: "backend-feature",
        transcript: [],
      }),
    ).toBeDefined();
  });

  it("PlanArtifact requires steps + verificationScenarios", () => {
    expect(
      PlanArtifactSchema.parse({
        goal: "x",
        patternsToFollow: [],
        touchpoints: [],
        blastRadius: [],
        precedentWarnings: [],
        steps: [{ id: "s1", title: "t", files: [], assertion: "a" }],
        verificationScenarios: { scenarios: [] },
        outOfScope: [],
        suggestedWorkflow: "backend-feature",
      }),
    ).toBeDefined();
  });

  it("ProofReport requires per-scenario results + overall ok", () => {
    expect(
      ProofReportSchema.parse({
        runId: "r1",
        ok: true,
        scenarios: [
          { id: "s1", type: "api", ok: true, evidence: { responseFile: "x.json", status: 200 } },
        ],
      }),
    ).toBeDefined();
  });

  it("rejects ProofReport missing scenarios", () => {
    expect(() => ProofReportSchema.parse({ runId: "r", ok: true })).toThrow();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @pi-harness/shared test artifacts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/types/artifacts.ts`**

`packages/shared/src/types/artifacts.ts`:
```typescript
import type { Workflow } from "./task.js";
import type { ScenarioFile } from "./scenario.js";

export type BrainstormTurn = { role: "agent" | "user"; text: string; ts: string };

export type BrainstormArtifact = {
  goal: string;
  decisions: string[];
  openQuestions: string[];
  suggestedWorkflow: Workflow;
  transcript: BrainstormTurn[];
};

export type PlanStep = {
  id: string;
  title: string;
  files: { path: string; action: "create" | "modify" }[];
  patternRef?: string; // e.g. "src/auth/login.ts:42 — model after this"
  assertion: string; // what proves this step is done
};

export type PlanArtifact = {
  goal: string;
  patternsToFollow: { ref: string; note: string }[];
  touchpoints: { layer: string; files: string[]; finding: string }[];
  blastRadius: string[];
  precedentWarnings: { ref: string; lesson: string }[];
  steps: PlanStep[];
  verificationScenarios: ScenarioFile;
  outOfScope: string[];
  suggestedWorkflow: Workflow;
};

export type ScenarioResult = {
  id: string;
  type: "api" | "ui" | "ui-visual";
  ok: boolean;
  durationMs?: number;
  error?: string;
  evidence: {
    responseFile?: string;
    screenshotFile?: string;
    status?: number;
  };
};

export type ProofReport = {
  runId: string;
  ok: boolean;
  scenarios: ScenarioResult[];
  startedAt?: string;
  endedAt?: string;
};
```

- [ ] **Step 4: Implement `src/schemas/artifacts.ts`**

`packages/shared/src/schemas/artifacts.ts`:
```typescript
import { z } from "zod";
import { ScenarioFileSchema } from "./scenario.js";
import { WORKFLOWS } from "../types/task.js";

export const BrainstormArtifactSchema = z.object({
  goal: z.string().min(1),
  decisions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  suggestedWorkflow: z.enum(WORKFLOWS),
  transcript: z.array(
    z.object({ role: z.enum(["agent", "user"]), text: z.string(), ts: z.string() }),
  ),
});

export const PlanStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  files: z.array(
    z.object({ path: z.string().min(1), action: z.enum(["create", "modify"]) }),
  ),
  patternRef: z.string().optional(),
  assertion: z.string().min(1),
});

export const PlanArtifactSchema = z.object({
  goal: z.string().min(1),
  patternsToFollow: z.array(z.object({ ref: z.string(), note: z.string() })),
  touchpoints: z.array(
    z.object({ layer: z.string(), files: z.array(z.string()), finding: z.string() }),
  ),
  blastRadius: z.array(z.string()),
  precedentWarnings: z.array(z.object({ ref: z.string(), lesson: z.string() })),
  steps: z.array(PlanStepSchema),
  verificationScenarios: ScenarioFileSchema,
  outOfScope: z.array(z.string()),
  suggestedWorkflow: z.enum(WORKFLOWS),
});

export const ScenarioResultSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["api", "ui", "ui-visual"]),
  ok: z.boolean(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
  evidence: z.object({
    responseFile: z.string().optional(),
    screenshotFile: z.string().optional(),
    status: z.number().optional(),
  }),
});

export const ProofReportSchema = z.object({
  runId: z.string().min(1),
  ok: z.boolean(),
  scenarios: z.array(ScenarioResultSchema),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
});
```

- [ ] **Step 5: Re-export from index**

Edit `packages/shared/src/index.ts` to add:
```typescript
export * from "./types/artifacts.js";
export {
  BrainstormArtifactSchema,
  PlanArtifactSchema,
  PlanStepSchema,
  ScenarioResultSchema,
  ProofReportSchema,
} from "./schemas/artifacts.js";
```

- [ ] **Step 6: Run, verify pass**

Run: `pnpm --filter @pi-harness/shared test artifacts`
Expected: PASS — 4 tests.

- [ ] **Step 7: Build**

Run: `pnpm --filter @pi-harness/shared build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): artifact types — Brainstorm/Plan/ProofReport"
```

---

## Task 2: Author `verification-author.md` subagent prompt

The subagent the planner invokes in phase 6 of its pipeline (spec §7.1). It reads brainstorm + plan and emits `verification.yaml`. Same Markdown-with-frontmatter shape as rpiv vendored agents — the existing `runSubagent()` from Plan 1 invokes it identically.

**Files:**
- Create: `subagents/ours/verification-author.md`

- [ ] **Step 1: Create `subagents/ours/verification-author.md`**

`subagents/ours/verification-author.md`:
```markdown
---
name: verification-author
description: "Drafts executable Verification Scenarios (api / ui / ui-visual) from a brainstorm artifact and a draft plan. Returns YAML matching the .harness/runs/<task-id>/verification.yaml schema. Use ONCE per task, in phase 6 of the Planning Agent's pipeline."
tools: read, grep, find
isolated: true
---

You are a specialist at translating a feature description and a code plan into executable Verification Scenarios. Your job is to emit a YAML document that the Verifier Agent can run end-to-end against a real running app — NOT to write tests, NOT to reason about implementation choices, NOT to negotiate scope.

## Inputs

The caller provides:
1. The brainstorm artifact (`.harness/runs/<task-id>/brainstorm.md`).
2. The current draft plan (`.harness/runs/<task-id>/plan.md`).
3. The repo root path.

Read all three before drafting.

## Output format (strict)

Return ONE YAML document and nothing else. Schema:

```yaml
scenarios:
  - id: <kebab-case-stable-id>
    type: api | ui | ui-visual
    name: <short human label>
    setup:
      - bash: <command>           # optional
    request:                      # only for type=api
      method: GET|POST|PUT|DELETE|PATCH
      url: <full url>
      headers: { … }              # optional
      body: { … }                 # optional
    expect:                       # type=api
      status: <int>
      body_contains: ["<str>"]    # optional
    steps:                        # type=ui or ui-visual
      - navigate: <url>
      - fill: { selector: "[name=…]", value: "…" }
      - click: <selector>
      - wait_for_url: <pattern>
    expect:                       # type=ui
      url_matches: <pattern>      # optional
      screenshot: <filename>      # optional
    capture:                      # type=ui-visual ONLY
      selector: <css>             # optional
      full_page: true|false       # optional
      filename: <name>.png
```

## Rules

1. **Every scenario must be executable without modification.** No placeholder URLs, no `<TODO>` strings.
2. **Cover at least one happy path AND one negative path** for each behavior the plan adds.
3. **Prefer `api` over `ui`** when the change is backend-only. UI scenarios cost more to run.
4. **`ui-visual` only when the plan explicitly adds visible UI** — never as decoration.
5. **Stable ids.** Use `<area>-<behavior>-<expected-status>`, e.g. `signed-payload-200`, `tampered-payload-401`.
6. **Bounded.** 3–8 scenarios per task. More than 8 means the task should have been split.
7. **Setup is optional, not aspirational.** If the test requires DB seed data, write the bash command — don't describe it in prose.

## What NOT to do

- Don't write unit tests — those belong in the project's test suite, not the gate.
- Don't make assertions about implementation details (function names, internal types).
- Don't include scenarios for features outside the plan's scope.
- Don't emit Markdown, prose, or commentary — YAML only.
```

- [ ] **Step 2: Verify it parses as valid frontmatter**

Run:
```bash
node -e '
const fs = require("fs");
const yaml = require("js-yaml");
const txt = fs.readFileSync("subagents/ours/verification-author.md","utf8");
const m = txt.match(/^---\n([\s\S]+?)\n---/);
if (!m) { console.error("no frontmatter"); process.exit(1); }
const fm = yaml.load(m[1]);
console.log(JSON.stringify(fm));
'
```
Expected: `{"name":"verification-author","description":"...","tools":["read","grep","find"],"isolated":true}` (or the equivalent — yaml lib may serialise list/string differently).

If the snippet errors because `js-yaml` isn't installed at the root yet, install it:
```bash
pnpm add -Dw js-yaml @types/js-yaml
```
then retry.

- [ ] **Step 3: Commit**

```bash
git add subagents/ours/verification-author.md
git commit -m "feat(subagents): verification-author prompt"
```

---

## Task 3: Author `proof-capture.md` and `screenshot-taker.md`

The two helper subagents the Verifier Agent calls. `proof-capture` runs a single scenario and writes its evidence slice. `screenshot-taker` is its Playwright wrapper.

**Files:**
- Create: `subagents/ours/proof-capture.md`, `subagents/ours/screenshot-taker.md`

- [ ] **Step 1: Create `subagents/ours/proof-capture.md`**

`subagents/ours/proof-capture.md`:
```markdown
---
name: proof-capture
description: "Executes ONE Verification Scenario end-to-end against a running app and writes its evidence to .harness/runs/<task-id>/proof/. Returns a JSON ScenarioResult. Use INSIDE the verify phase, once per scenario, never standalone."
tools: bash, read, write
isolated: true
---

You are a specialist at executing a single Verification Scenario and capturing concrete proof. Your job is NOT to author the scenario, NOT to fix code, NOT to interpret failures — only to run, record, and report.

## Inputs

The caller provides ONE scenario object (api / ui / ui-visual shape) and:
- `proofDir`: absolute path to `.harness/runs/<task-id>/proof/`
- `cwd`: the repo worktree path
- `appBaseUrl`: the URL the Verifier started the app on

## What you do

1. Run any `setup[].bash` commands first, in order, with `cwd` set.
2. Execute the scenario based on its `type`:
   - **api**: build the curl request from `request.{method,url,headers,body}`, POST it, capture the response body and status.
   - **ui**: dispatch `screenshot-taker` to drive Playwright through `steps[]`, then assert `expect.url_matches` and capture `expect.screenshot`.
   - **ui-visual**: dispatch `screenshot-taker` to walk `steps[]` and capture `capture.filename` per the selector/full_page rules.
3. Write evidence under `proofDir/`:
   - api: `responses/<scenario-id>.json` (the full response body)
   - ui / ui-visual: `screenshots/<filename>` (handed back from screenshot-taker)
4. Return a JSON object matching `ScenarioResult`:

```json
{
  "id": "<scenario.id>",
  "type": "<scenario.type>",
  "ok": true|false,
  "durationMs": <int>,
  "error": "<string if !ok>",
  "evidence": {
    "responseFile": "responses/<scenario-id>.json",
    "screenshotFile": "screenshots/<filename>",
    "status": <int>
  }
}
```

Print the JSON as your final assistant message, prefixed with `RESULT:` on its own line.

## What NOT to do

- Don't retry. The Verifier orchestrates retries at the scenario level.
- Don't modify code under any circumstances. If a scenario fails, capture the failure and exit.
- Don't capture more screenshots than the scenario requests — disk is finite.
- Don't print debug output between command invocations; the orchestrator parses your final RESULT line.
```

- [ ] **Step 2: Create `subagents/ours/screenshot-taker.md`**

`subagents/ours/screenshot-taker.md`:
```markdown
---
name: screenshot-taker
description: "Drives Playwright through a list of UI steps and captures a single screenshot. Returns the absolute path to the saved file. Use INSIDE proof-capture, never standalone."
tools: bash, read, write
isolated: true
---

You are a Playwright wrapper. Your job is to execute a sequence of UI steps and capture one screenshot. You do not interpret results, do not retry, do not modify code.

## Inputs

The caller provides:
- `steps`: ordered list of step objects (`navigate`, `fill`, `click`, `wait_for_url`).
- `capture`: an object with `selector?`, `full_page?`, and `filename`.
- `appBaseUrl`: the URL the app is reachable at.
- `outDir`: absolute path where the screenshot file should be written.

## What you do

1. Write a temporary node script in `outDir/.shot.mjs` that:
   - Imports `chromium` from `playwright`.
   - Launches headless, sets viewport 1280x800.
   - Walks `steps[]` in order:
     - `navigate`: `page.goto(url)` (resolve relative paths against `appBaseUrl`).
     - `fill`: `page.fill(selector, value)`.
     - `click`: `page.click(selector)`.
     - `wait_for_url`: `page.waitForURL(pattern)`.
   - Calls `page.screenshot({ path: outDir+"/"+filename, fullPage: capture.full_page === true, clip: capture.selector ? <bbox> : undefined })`.
   - Closes the browser.
2. Run it: `node outDir/.shot.mjs`.
3. Delete the script.
4. Print `OUTPUT: <abs path>` on its own line as your final message.

If any step fails, exit non-zero with `OUTPUT: ERROR <message>`.

## What NOT to do

- Don't run with `headless: false` — must be silent.
- Don't capture multiple screenshots — exactly one per call.
- Don't keep the temp script around — clean up always.
- Don't add visual baselines or diff logic — that's the Verifier's responsibility.
```

- [ ] **Step 3: Verify both parse**

Run:
```bash
for f in subagents/ours/proof-capture.md subagents/ours/screenshot-taker.md; do
  node -e "
    const fs = require('fs');
    const yaml = require('js-yaml');
    const txt = fs.readFileSync('$f','utf8');
    const m = txt.match(/^---\n([\s\S]+?)\n---/);
    const fm = yaml.load(m[1]);
    console.log('$f', fm.name);
  "
done
```
Expected:
```
subagents/ours/proof-capture.md proof-capture
subagents/ours/screenshot-taker.md screenshot-taker
```

- [ ] **Step 4: Commit**

```bash
git add subagents/ours/proof-capture.md subagents/ours/screenshot-taker.md
git commit -m "feat(subagents): proof-capture + screenshot-taker prompts"
```

---

## Task 4: Extend subagent loader for `ours/`

Plan 1 only resolved `_vendored/`. The phase drivers in this plan dispatch `verification-author`, `proof-capture`, `screenshot-taker` from `ours/`.

**Files:**
- Modify: `subagents/index.ts`, `subagents/test/loader.test.ts`

- [ ] **Step 1: Read current loader**

Read `subagents/index.ts`. It exports `resolveAgentPath(name)` and `listVendoredAgents()`.

- [ ] **Step 2: Add failing test**

Append to `subagents/test/loader.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { resolveAgentPath, listOurAgents, EXPECTED_OUR_AGENTS } from "../index.js";
import { existsSync } from "node:fs";

describe("ours/ resolution", () => {
  it("resolves verification-author from ours/", () => {
    const p = resolveAgentPath("verification-author");
    expect(p).toContain("ours/verification-author.md");
    expect(existsSync(p)).toBe(true);
  });

  it("listOurAgents includes the three new agents", () => {
    const list = listOurAgents().sort();
    expect(list).toEqual(EXPECTED_OUR_AGENTS.slice().sort());
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `pnpm --filter @pi-harness/subagents test`
Expected: FAIL — `listOurAgents` not exported.

- [ ] **Step 4: Update `subagents/index.ts`**

Add to `subagents/index.ts`:
```typescript
import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";

const ROOT = join(import.meta.dirname ?? __dirname, ".");
const OUR_DIR = join(ROOT, "ours");

export const EXPECTED_OUR_AGENTS = [
  "verification-author",
  "proof-capture",
  "screenshot-taker",
] as const;

export function listOurAgents(): string[] {
  if (!existsSync(OUR_DIR)) return [];
  return readdirSync(OUR_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3));
}
```

Modify the existing `resolveAgentPath` to fall through to `ours/`:
```typescript
export function resolveAgentPath(name: string): string {
  // Try _vendored first (the rpiv fleet), then ours/.
  const vendored = join(VENDORED_DIR, `${name}.md`);
  if (existsSync(vendored)) return vendored;
  const ours = join(OUR_DIR, `${name}.md`);
  if (existsSync(ours)) return ours;
  throw new Error(`subagent not found: ${name}`);
}
```

- [ ] **Step 5: Update `pi-bridge.runSubagent` to use the loader, not a hard-coded path**

Plan 1 originally had `runSubagent` hard-coding `_vendored/`. Edit `packages/pi-bridge/src/subagent.ts`:

Replace:
```typescript
const promptFile = resolve(SUBAGENTS_ROOT, "_vendored", `${spec.agent}.md`);
```

with:
```typescript
import { resolveAgentPath } from "@pi-harness/subagents";
// ...
const promptFile = resolveAgentPath(spec.agent);
```

And add `"@pi-harness/subagents": "workspace:*"` to `packages/pi-bridge/package.json` `dependencies`.

- [ ] **Step 6: Install + test**

Run: `pnpm install && pnpm --filter @pi-harness/subagents test && pnpm --filter @pi-harness/pi-bridge build`
Expected: PASS on subagents tests; clean build on pi-bridge.

- [ ] **Step 7: Commit**

```bash
git add subagents packages/pi-bridge
git commit -m "feat(subagents): resolve ours/ agents; pi-bridge uses loader"
```

---

## Task 5: Artifacts store

A small filesystem helper every phase driver uses to read/write `.harness/runs/<task-id>/*`. Centralized so we don't sprinkle path joins across drivers.

**Files:**
- Create: `apps/orchestrator/src/agents/artifacts-store.ts`, `apps/orchestrator/test/agents/artifacts-store.test.ts`

- [ ] **Step 1: Write failing test**

`apps/orchestrator/test/agents/artifacts-store.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactsStore } from "../../src/agents/artifacts-store.js";

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "art-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("ArtifactsStore", () => {
  it("writes and reads brainstorm artifact", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const art = {
      goal: "x",
      decisions: [],
      openQuestions: [],
      suggestedWorkflow: "backend-feature" as const,
      transcript: [],
    };
    await store.writeBrainstorm("task-1", art);
    const back = await store.readBrainstorm("task-1");
    expect(back.goal).toBe("x");

    // also writes a markdown sibling for the dashboard
    const md = await readFile(join(scratch, "task-1", "brainstorm.md"), "utf8");
    expect(md).toContain("Goal");
  });

  it("paths are scoped under task-id dir", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    expect(store.runDir("task-2")).toBe(join(scratch, "task-2"));
    expect(store.proofDir("task-2")).toBe(join(scratch, "task-2", "proof"));
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test artifacts-store`
Expected: FAIL.

- [ ] **Step 3: Implement `src/agents/artifacts-store.ts`**

`apps/orchestrator/src/agents/artifacts-store.ts`:
```typescript
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  BrainstormArtifactSchema,
  PlanArtifactSchema,
  ProofReportSchema,
  type BrainstormArtifact,
  type PlanArtifact,
  type ProofReport,
} from "@pi-harness/shared";

// Centralizes filesystem layout for `.harness/runs/<task-id>/`. Every phase
// driver reads/writes through here so no driver knows the literal paths.
//
// Layout:
//   <runsDir>/<task-id>/
//     ├── brainstorm.json   (machine-readable)
//     ├── brainstorm.md     (human/dashboard-readable)
//     ├── plan.json
//     ├── plan.md
//     ├── verification.yaml (handed off from plan to verify)
//     └── proof/
//         ├── proof-report.json
//         ├── proof-report.md
//         ├── responses/
//         └── screenshots/
export class ArtifactsStore {
  private readonly runsDir: string;

  constructor(opts: { runsDir: string }) {
    this.runsDir = resolve(opts.runsDir);
  }

  runDir(taskId: string): string {
    return join(this.runsDir, taskId);
  }

  proofDir(taskId: string): string {
    return join(this.runDir(taskId), "proof");
  }

  async writeBrainstorm(taskId: string, art: BrainstormArtifact): Promise<void> {
    const dir = this.runDir(taskId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "brainstorm.json"), JSON.stringify(art, null, 2));
    await writeFile(join(dir, "brainstorm.md"), brainstormToMd(art));
  }

  async readBrainstorm(taskId: string): Promise<BrainstormArtifact> {
    const raw = await readFile(join(this.runDir(taskId), "brainstorm.json"), "utf8");
    return BrainstormArtifactSchema.parse(JSON.parse(raw));
  }

  async writePlan(taskId: string, art: PlanArtifact): Promise<void> {
    const dir = this.runDir(taskId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "plan.json"), JSON.stringify(art, null, 2));
    await writeFile(join(dir, "plan.md"), planToMd(art));
    await writeFile(
      join(dir, "verification.yaml"),
      scenariosToYaml(art.verificationScenarios),
    );
  }

  async readPlan(taskId: string): Promise<PlanArtifact> {
    const raw = await readFile(join(this.runDir(taskId), "plan.json"), "utf8");
    return PlanArtifactSchema.parse(JSON.parse(raw));
  }

  async writeProofReport(taskId: string, report: ProofReport): Promise<void> {
    const dir = this.proofDir(taskId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "proof-report.json"), JSON.stringify(report, null, 2));
    await writeFile(join(dir, "proof-report.md"), proofToMd(report));
  }

  async readProofReport(taskId: string): Promise<ProofReport> {
    const raw = await readFile(
      join(this.proofDir(taskId), "proof-report.json"),
      "utf8",
    );
    return ProofReportSchema.parse(JSON.parse(raw));
  }
}

function brainstormToMd(a: BrainstormArtifact): string {
  return [
    `# Brainstorm`,
    ``,
    `## Goal`,
    a.goal,
    ``,
    `## Decisions`,
    ...a.decisions.map((d) => `- ${d}`),
    ``,
    `## Open questions`,
    ...a.openQuestions.map((q, i) => `${i + 1}. ${q}`),
    ``,
    `## Suggested workflow`,
    `\`${a.suggestedWorkflow}\``,
  ].join("\n");
}

function planToMd(a: PlanArtifact): string {
  return [
    `# Plan`,
    ``,
    `## Goal`,
    a.goal,
    ``,
    `## Patterns to follow`,
    ...a.patternsToFollow.map((p) => `- \`${p.ref}\` — ${p.note}`),
    ``,
    `## Touchpoints`,
    ...a.touchpoints.map(
      (t) => `### ${t.layer}\n${t.files.map((f) => `- \`${f}\``).join("\n")}\n\n${t.finding}`,
    ),
    ``,
    `## Steps`,
    ...a.steps.map(
      (s) =>
        `### ${s.id}: ${s.title}\n` +
        s.files.map((f) => `- ${f.action} \`${f.path}\``).join("\n") +
        (s.patternRef ? `\n\nPattern: \`${s.patternRef}\`` : "") +
        `\n\nDone when: ${s.assertion}`,
    ),
    ``,
    `## Out of scope`,
    ...a.outOfScope.map((o) => `- ${o}`),
  ].join("\n\n");
}

function proofToMd(r: ProofReport): string {
  const lines = [
    `# Proof Report`,
    ``,
    `**Run:** \`${r.runId}\`  `,
    `**Result:** ${r.ok ? "✅ all green" : "❌ failures present"}  `,
    ``,
    `## Scenarios`,
  ];
  for (const s of r.scenarios) {
    lines.push(
      `\n### ${s.ok ? "✓" : "✗"} \`${s.id}\` (${s.type})`,
      ...(s.error ? [``, `**Error:** ${s.error}`] : []),
      ...(s.evidence.responseFile ? [``, `Response: \`${s.evidence.responseFile}\``] : []),
      ...(s.evidence.screenshotFile
        ? [``, `Screenshot: \`${s.evidence.screenshotFile}\``]
        : []),
    );
  }
  return lines.join("\n");
}

function scenariosToYaml(file: { scenarios: unknown[] }): string {
  // Lightweight serializer; we don't need full yaml fidelity, just round-trip.
  // The verification-author subagent emits canonical yaml; we just persist it.
  // For programmatic use we serialize via JSON.stringify and rely on the yaml
  // parser being lenient enough. (js-yaml is added in Task 2.)
  return `# generated by verification-author\n${JSON.stringify(file, null, 2)}`;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test artifacts-store`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/agents/artifacts-store.ts apps/orchestrator/test/agents/artifacts-store.test.ts
git commit -m "feat(orchestrator): ArtifactsStore for runs dir"
```

---

## Task 6: Brainstorm Agent driver + prompt

The Brainstorm phase. Drives the SSE chat in the dashboard and emits `BrainstormArtifact`. The system prompt lives in `prompts/brainstorm.md`. The driver loads it, opens a pi session, and pumps user turns from the dashboard until the agent emits a `<brainstorm-complete>` sentinel — then parses the final structured output.

**Files:**
- Create: `apps/orchestrator/src/agents/prompts/brainstorm.md`, `apps/orchestrator/src/agents/brainstorm.ts`, `apps/orchestrator/test/agents/brainstorm.test.ts`

- [ ] **Step 1: Create `prompts/brainstorm.md`**

`apps/orchestrator/src/agents/prompts/brainstorm.md`:
```markdown
You are the **Brainstorm Agent** for pi-harness. Your job is to take a one-line ticket and, through a tight chat with the user, produce a `BrainstormArtifact`: a goal, a list of accepted decisions, a list of open questions, and a suggested workflow.

## Constraints

- Ask **one** question per turn. Never bundle two questions.
- Aim for 3–5 questions total. If you need more, you've gone too broad — narrow.
- Prefer **multiple-choice** questions over open-ended when the choice space is small.
- After every user answer, restate the new `decision` you've recorded. Be terse.
- The dashboard renders your "Emerging Spec" pane from your structured output; keep it crisp.

## Output protocol

When you have enough to proceed (typically after 3–5 turns), emit on a single line:

```
<brainstorm-complete>
```

immediately followed by a JSON block fenced by ```json ... ``` matching the `BrainstormArtifact` schema. Nothing after the closing fence.

The orchestrator parses this block. If parsing fails it kicks the run back; emit the JSON exactly once and exactly to schema.

## What NOT to do

- Don't write code, don't propose architecture, don't list implementation steps. That's the Planner's job.
- Don't ask "anything else?" — propose a closing decision and the user can amend.
- Don't summarize the chat in prose. The JSON block is the summary.
```

- [ ] **Step 2: Write failing test (mocked pi-bridge)**

`apps/orchestrator/test/agents/brainstorm.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { runBrainstorm } from "../../src/agents/brainstorm.js";
import type { ArtifactsStore } from "../../src/agents/artifacts-store.js";

describe("runBrainstorm", () => {
  it("parses the agent's final JSON block and writes the artifact", async () => {
    const fakeArtifact = {
      goal: "Retry webhooks bounded.",
      decisions: ["expo backoff", "max 5 attempts"],
      openQuestions: [],
      suggestedWorkflow: "backend-feature" as const,
      transcript: [],
    };
    const finalText = `<brainstorm-complete>\n\`\`\`json\n${JSON.stringify(fakeArtifact)}\n\`\`\``;

    const session = {
      prompt: vi.fn(async () => ({
        finalText,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.001,
      })),
      close: vi.fn(async () => {}),
    };
    const createSession = vi.fn(async () => session);

    const writeBrainstorm = vi.fn(async () => {});
    const store = { writeBrainstorm } as unknown as ArtifactsStore;

    const result = await runBrainstorm({
      taskId: "t-1",
      ticketTitle: "Webhook retry policy",
      ticketDescription: "",
      cwd: "/tmp",
      onEvent: () => {},
      createSession,
      store,
    });

    expect(result.ok).toBe(true);
    expect(writeBrainstorm).toHaveBeenCalledWith("t-1", expect.objectContaining({ goal: fakeArtifact.goal }));
  });

  it("returns ok:false when the final block doesn't parse", async () => {
    const session = {
      prompt: vi.fn(async () => ({
        finalText: "I forgot to emit json",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
      })),
      close: vi.fn(async () => {}),
    };

    const result = await runBrainstorm({
      taskId: "t-2",
      ticketTitle: "x",
      ticketDescription: "",
      cwd: "/tmp",
      onEvent: () => {},
      createSession: async () => session,
      store: { writeBrainstorm: async () => {} } as unknown as ArtifactsStore,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("brainstorm-complete");
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test brainstorm`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/agents/brainstorm.ts`**

`apps/orchestrator/src/agents/brainstorm.ts`:
```typescript
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PiSession, PiBridgeEvent } from "@pi-harness/pi-bridge";
import { BrainstormArtifactSchema, type BrainstormArtifact } from "@pi-harness/shared";
import type { ArtifactsStore } from "./artifacts-store.js";

const SYSTEM_PATH = resolve(import.meta.dirname ?? __dirname, "prompts", "brainstorm.md");

export type BrainstormOpts = {
  taskId: string;
  ticketTitle: string;
  ticketDescription: string;
  cwd: string;
  onEvent: (e: PiBridgeEvent) => void;
  createSession: (opts: {
    cwd: string;
    systemPrompt?: string;
    onEvent: (e: PiBridgeEvent) => void;
  }) => Promise<PiSession>;
  store: ArtifactsStore;
};

export type BrainstormResult = {
  ok: boolean;
  artifact?: BrainstormArtifact;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
};

export async function runBrainstorm(opts: BrainstormOpts): Promise<BrainstormResult> {
  const systemPrompt = await readFile(SYSTEM_PATH, "utf8");
  const session = await opts.createSession({
    cwd: opts.cwd,
    systemPrompt,
    onEvent: opts.onEvent,
  });

  try {
    const userMessage =
      `Ticket: ${opts.ticketTitle}\n\n` +
      (opts.ticketDescription ? `Description:\n${opts.ticketDescription}` : "(no description)");

    const result = await session.prompt(userMessage);
    const parsed = parseFinalArtifact(result.finalText);
    if (!parsed.ok) {
      return {
        ok: false,
        costUsd: result.costUsd,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        error: parsed.error,
      };
    }
    await opts.store.writeBrainstorm(opts.taskId, parsed.artifact);
    return {
      ok: true,
      artifact: parsed.artifact,
      costUsd: result.costUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  } finally {
    await session.close();
  }
}

function parseFinalArtifact(
  text: string,
): { ok: true; artifact: BrainstormArtifact } | { ok: false; error: string } {
  const sentinel = text.indexOf("<brainstorm-complete>");
  if (sentinel === -1) {
    return { ok: false, error: "missing <brainstorm-complete> sentinel" };
  }
  const after = text.slice(sentinel);
  const m = after.match(/```json\s*([\s\S]+?)\s*```/);
  if (!m) return { ok: false, error: "missing ```json block after sentinel" };
  try {
    const obj = JSON.parse(m[1]!);
    return { ok: true, artifact: BrainstormArtifactSchema.parse(obj) };
  } catch (e) {
    return { ok: false, error: `parse error: ${(e as Error).message}` };
  }
}
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test brainstorm`
Expected: PASS — 2 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/orchestrator/src/agents/brainstorm.ts apps/orchestrator/src/agents/prompts/brainstorm.md apps/orchestrator/test/agents/brainstorm.test.ts
git commit -m "feat(orchestrator): Brainstorm Agent driver + prompt"
```

---

## Task 7: Plan fanout helper + test

The Planning Agent fans out to 5–7 rpiv subagents in parallel during phases 2–3 of its pipeline (spec §7.1). This is a hot path: a slow fanout dominates the plan phase. Centralize it.

**Files:**
- Create: `apps/orchestrator/src/agents/plan-fanout.ts`, `apps/orchestrator/test/agents/plan-fanout.test.ts`

- [ ] **Step 1: Write failing test**

`apps/orchestrator/test/agents/plan-fanout.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { fanoutResearch, REQUIRED_RESEARCHERS } from "../../src/agents/plan-fanout.js";

describe("fanoutResearch", () => {
  it("dispatches every required researcher in parallel", async () => {
    const calls: string[] = [];
    const runSubagent = vi.fn(async (spec: { agent: string }) => {
      calls.push(spec.agent);
      return { ok: true, output: `out-${spec.agent}`, inputTokens: 1, outputTokens: 1, costUsd: 0 };
    });

    const result = await fanoutResearch({
      cwd: "/tmp",
      task: "Webhook retry",
      runSubagent,
    });

    expect(calls.sort()).toEqual(REQUIRED_RESEARCHERS.slice().sort());
    expect(Object.keys(result.findings).sort()).toEqual(REQUIRED_RESEARCHERS.slice().sort());
    expect(result.totalCostUsd).toBe(0);
  });

  it("aggregates costs and tokens", async () => {
    let i = 0;
    const runSubagent = vi.fn(async () => ({
      ok: true,
      output: `o-${i++}`,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
    }));

    const result = await fanoutResearch({ cwd: "/tmp", task: "x", runSubagent });
    expect(result.totalCostUsd).toBe(0.001 * REQUIRED_RESEARCHERS.length);
    expect(result.totalInputTokens).toBe(10 * REQUIRED_RESEARCHERS.length);
  });

  it("captures failures without aborting siblings", async () => {
    const runSubagent = vi.fn(async (spec: { agent: string }) => ({
      ok: spec.agent !== "codebase-analyzer",
      output: "",
      error: spec.agent === "codebase-analyzer" ? "boom" : undefined,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    }));

    const result = await fanoutResearch({ cwd: "/tmp", task: "x", runSubagent });
    expect(result.findings["codebase-analyzer"]?.ok).toBe(false);
    expect(result.findings["codebase-locator"]?.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test plan-fanout`
Expected: FAIL.

- [ ] **Step 3: Implement `src/agents/plan-fanout.ts`**

`apps/orchestrator/src/agents/plan-fanout.ts`:
```typescript
import type { PiSubagentSpec, PiSubagentResult } from "@pi-harness/pi-bridge";

// The five researchers we always dispatch (spec §7.1 phases 2a–3a, minus the
// optional peer-comparator). Adding `peer-comparator` is a fanout-time decision
// the planner makes after scope-tracer; this constant is the always-on set.
export const REQUIRED_RESEARCHERS = [
  "codebase-locator",
  "codebase-pattern-finder",
  "codebase-analyzer",
  "integration-scanner",
  "test-case-locator",
  "precedent-locator",
] as const;

export type Researcher = (typeof REQUIRED_RESEARCHERS)[number];

export type ResearchFinding = {
  ok: boolean;
  output: string;
  error?: string;
  costUsd: number;
};

export type FanoutResult = {
  findings: Record<string, ResearchFinding>;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
};

type RunSubagent = (spec: PiSubagentSpec) => Promise<PiSubagentResult>;

export async function fanoutResearch(opts: {
  cwd: string;
  task: string;
  runSubagent: RunSubagent;
}): Promise<FanoutResult> {
  const settled = await Promise.all(
    REQUIRED_RESEARCHERS.map(async (agent) => {
      const r = await opts.runSubagent({ agent, task: opts.task, cwd: opts.cwd });
      return { agent, r };
    }),
  );

  const findings: Record<string, ResearchFinding> = {};
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const { agent, r } of settled) {
    findings[agent] = { ok: r.ok, output: r.output, error: r.error, costUsd: r.costUsd };
    totalCostUsd += r.costUsd;
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;
  }

  return { findings, totalCostUsd, totalInputTokens, totalOutputTokens };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test plan-fanout`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/agents/plan-fanout.ts apps/orchestrator/test/agents/plan-fanout.test.ts
git commit -m "feat(orchestrator): plan-fanout — parallel research dispatch"
```

---

## Task 8: Planning Agent driver + prompt

Wires the full §7.1 pipeline: scope → fanout → synthesize → claim-verify → verification-author → revise. The driver is sequential at the top level but fans out internally. Output: `PlanArtifact` written via the artifacts store.

**Files:**
- Create: `apps/orchestrator/src/agents/prompts/plan.md`, `apps/orchestrator/src/agents/plan.ts`, `apps/orchestrator/test/agents/plan.test.ts`

- [ ] **Step 1: Create `prompts/plan.md`**

`apps/orchestrator/src/agents/prompts/plan.md`:
```markdown
You are the **Planning Agent** for pi-harness. You receive an approved Brainstorm Artifact and produce a codebase-grounded Plan Artifact the Coder can follow without re-investigating.

## Inputs you have

1. The brainstorm JSON (goal, decisions, open questions, suggested workflow).
2. Aggregated findings from research subagents — already dispatched on your behalf:
   - `scope-tracer` — bounded the investigation, emitted Discovery Summary + numbered questions
   - `codebase-locator` — where relevant files live
   - `codebase-pattern-finder` — examples to model after
   - `codebase-analyzer` — how touchpoints work today
   - `integration-scanner` — inbound/outbound edges (blast radius)
   - `test-case-locator` — existing test coverage
   - `precedent-locator` — past similar changes + follow-up fixes

These appear in your input prompt as labeled sections. **Do not re-run them.**

3. Optional: `peer-comparator` findings if a clear sibling entity exists.

## What you produce

A single JSON block matching the `PlanArtifact` schema, fenced by ```json. Required keys:
`goal`, `patternsToFollow[]`, `touchpoints[]`, `blastRadius[]`, `precedentWarnings[]`, `steps[]`, `verificationScenarios.scenarios[]`, `outOfScope[]`, `suggestedWorkflow`.

## Rules

1. **Every `steps[].patternRef` must cite a real file:line** from `codebase-pattern-finder`. No invented references.
2. **Every `precedentWarnings[].lesson` must trace back to a real commit** from `precedent-locator`.
3. **`steps[]` are testable.** Each step's `assertion` is the literal predicate that proves it's done — runnable as a test or visible in the verification report.
4. **`verificationScenarios` come from your `verification-author` subagent call.** You don't author them by hand — dispatch the subagent with the brainstorm + your draft steps and paste back its YAML, converted to the schema.
5. **`outOfScope` is non-empty.** Every plan has some neighboring change that is *deliberately not* in scope; name it.
6. **`suggestedWorkflow` defaults to `backend-feature`** in v1 (only option).

## Self-check before emitting

After writing the plan but before the JSON block, dispatch your `claim-verifier` subagent with the draft. It tags each plan claim Verified / Weakened / Falsified. **Drop or rewrite every Falsified claim** before emitting.

## Output protocol

Same shape as Brainstorm: emit on a single line:

```
<plan-complete>
```

then a fenced ```json block, then nothing.
```

- [ ] **Step 2: Write failing test (mocks both fanout and pi session)**

`apps/orchestrator/test/agents/plan.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { runPlan } from "../../src/agents/plan.js";
import type { ArtifactsStore } from "../../src/agents/artifacts-store.js";

describe("runPlan", () => {
  it("dispatches research, runs the planner LLM, persists the artifact", async () => {
    const fanoutResearch = vi.fn(async () => ({
      findings: { "codebase-locator": { ok: true, output: "files: x.ts", costUsd: 0 } },
      totalCostUsd: 0,
      totalInputTokens: 5,
      totalOutputTokens: 5,
    }));

    const fakePlan = {
      goal: "x",
      patternsToFollow: [],
      touchpoints: [],
      blastRadius: [],
      precedentWarnings: [],
      steps: [{ id: "s1", title: "t", files: [], assertion: "a" }],
      verificationScenarios: { scenarios: [] },
      outOfScope: ["y"],
      suggestedWorkflow: "backend-feature" as const,
    };
    const finalText = `<plan-complete>\n\`\`\`json\n${JSON.stringify(fakePlan)}\n\`\`\``;

    const session = {
      prompt: vi.fn(async () => ({
        finalText,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.005,
      })),
      close: vi.fn(async () => {}),
    };

    const writePlan = vi.fn(async () => {});
    const readBrainstorm = vi.fn(async () => ({
      goal: "x",
      decisions: [],
      openQuestions: [],
      suggestedWorkflow: "backend-feature",
      transcript: [],
    }));
    const store = { writePlan, readBrainstorm } as unknown as ArtifactsStore;

    const result = await runPlan({
      taskId: "t-1",
      cwd: "/tmp",
      onEvent: () => {},
      createSession: async () => session,
      runSubagent: vi.fn(async () => ({
        ok: true,
        output: "",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      })),
      fanoutResearch,
      store,
    });

    expect(result.ok).toBe(true);
    expect(fanoutResearch).toHaveBeenCalledOnce();
    expect(writePlan).toHaveBeenCalledWith("t-1", expect.objectContaining({ goal: "x" }));
    expect(result.totalCostUsd).toBeCloseTo(0.005, 5); // research is 0
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test agents/plan`
Expected: FAIL.

- [ ] **Step 4: Implement `src/agents/plan.ts`**

`apps/orchestrator/src/agents/plan.ts`:
```typescript
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PiSession, PiBridgeEvent, PiSubagentResult, PiSubagentSpec } from "@pi-harness/pi-bridge";
import { PlanArtifactSchema, type PlanArtifact } from "@pi-harness/shared";
import type { ArtifactsStore } from "./artifacts-store.js";
import type { FanoutResult } from "./plan-fanout.js";

const SYSTEM_PATH = resolve(import.meta.dirname ?? __dirname, "prompts", "plan.md");

type RunSubagent = (spec: PiSubagentSpec) => Promise<PiSubagentResult>;
type Fanout = (opts: {
  cwd: string;
  task: string;
  runSubagent: RunSubagent;
}) => Promise<FanoutResult>;

export type PlanOpts = {
  taskId: string;
  cwd: string;
  onEvent: (e: PiBridgeEvent) => void;
  createSession: (opts: {
    cwd: string;
    systemPrompt?: string;
    onEvent: (e: PiBridgeEvent) => void;
  }) => Promise<PiSession>;
  runSubagent: RunSubagent;
  fanoutResearch: Fanout;
  store: ArtifactsStore;
};

export type PlanResult = {
  ok: boolean;
  artifact?: PlanArtifact;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  error?: string;
};

export async function runPlan(opts: PlanOpts): Promise<PlanResult> {
  const brainstorm = await opts.store.readBrainstorm(opts.taskId);

  // Phase 2–3 of §7.1: parallel research fanout.
  const research = await opts.fanoutResearch({
    cwd: opts.cwd,
    task: brainstorm.goal,
    runSubagent: opts.runSubagent,
  });

  // Phase 4: synthesis. The planner LLM gets brainstorm + all research findings
  // in its user message; the system prompt is plan.md.
  const systemPrompt = await readFile(SYSTEM_PATH, "utf8");
  const session = await opts.createSession({
    cwd: opts.cwd,
    systemPrompt,
    onEvent: opts.onEvent,
  });

  try {
    const userMessage = buildPlannerInput(brainstorm, research);
    const result = await session.prompt(userMessage);

    const parsed = parseFinalPlan(result.finalText);
    if (!parsed.ok) {
      return {
        ok: false,
        totalCostUsd: research.totalCostUsd + result.costUsd,
        totalInputTokens: research.totalInputTokens + result.inputTokens,
        totalOutputTokens: research.totalOutputTokens + result.outputTokens,
        error: parsed.error,
      };
    }
    await opts.store.writePlan(opts.taskId, parsed.artifact);
    return {
      ok: true,
      artifact: parsed.artifact,
      totalCostUsd: research.totalCostUsd + result.costUsd,
      totalInputTokens: research.totalInputTokens + result.inputTokens,
      totalOutputTokens: research.totalOutputTokens + result.outputTokens,
    };
  } finally {
    await session.close();
  }
}

function buildPlannerInput(
  brainstorm: { goal: string; decisions: string[] },
  research: FanoutResult,
): string {
  const lines: string[] = [];
  lines.push("## Brainstorm");
  lines.push(`Goal: ${brainstorm.goal}`);
  if (brainstorm.decisions.length) {
    lines.push("Decisions:");
    for (const d of brainstorm.decisions) lines.push(`- ${d}`);
  }
  lines.push("");
  lines.push("## Research findings");
  for (const [agent, finding] of Object.entries(research.findings)) {
    lines.push(`### ${agent}`);
    if (!finding.ok) {
      lines.push(`(failed: ${finding.error ?? "unknown"})`);
    } else {
      lines.push(finding.output);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function parseFinalPlan(
  text: string,
): { ok: true; artifact: PlanArtifact } | { ok: false; error: string } {
  const sentinel = text.indexOf("<plan-complete>");
  if (sentinel === -1) return { ok: false, error: "missing <plan-complete> sentinel" };
  const after = text.slice(sentinel);
  const m = after.match(/```json\s*([\s\S]+?)\s*```/);
  if (!m) return { ok: false, error: "missing ```json block" };
  try {
    return { ok: true, artifact: PlanArtifactSchema.parse(JSON.parse(m[1]!)) };
  } catch (e) {
    return { ok: false, error: `parse error: ${(e as Error).message}` };
  }
}
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test agents/plan`
Expected: PASS — 1 test.

- [ ] **Step 6: Commit**

```bash
git add apps/orchestrator/src/agents/plan.ts apps/orchestrator/src/agents/prompts/plan.md apps/orchestrator/test/agents/plan.test.ts
git commit -m "feat(orchestrator): Planning Agent driver — fanout + synthesize"
```

---

## Task 9: Coder Agent driver + prompt

Coder reads the plan and implements it inside the worktree using TDD. The system prompt enforces TDD discipline. The driver passes plan steps as user input and supports the retry path: a verification failure becomes a new turn on an existing session.

**Files:**
- Create: `apps/orchestrator/src/agents/prompts/code.md`, `apps/orchestrator/src/agents/code.ts`, `apps/orchestrator/test/agents/code.test.ts`

- [ ] **Step 1: Create `prompts/code.md`**

`apps/orchestrator/src/agents/prompts/code.md`:
```markdown
You are the **Coder Agent** for pi-harness. You receive a Plan Artifact and implement it inside a fresh git worktree. You ship code via TDD: red → green → commit per step.

## Hard rules

1. **TDD or nothing.** For every plan step that adds behavior, write the failing test first. Run it, see red, then write minimal code to green, then commit.
2. **One commit per step.** Conventional commits (`feat:`, `fix:`, `test:`, `refactor:`). Commit message body cites the plan step id.
3. **You are inside a worktree.** Don't `cd` out. Don't touch the user's main checkout. All paths are relative to your `cwd`.
4. **Patterns are not optional.** Every step's `patternRef` is a real file:line — open it, read it, mirror it.
5. **Do not modify tests to make them pass.** If a test you wrote can't be made to pass via implementation, the plan is wrong — emit `<coder-blocked>` with a one-line reason and stop.

## Retry behavior

If you receive a follow-up turn beginning with `## Verification failure`, the previous Verifier run found a scenario regression. The turn lists the failing scenario id, expected vs actual, and the latest response/screenshot. Read the artifact, then fix the corresponding plan step. Do not introduce new behavior beyond the failure scope.

## Output protocol

When the plan is fully implemented and `pnpm test` (or the project's equivalent) passes locally, emit on a single line:

```
<coder-complete>
```

then a JSON block fenced by ```json with shape:

```json
{
  "branch": "<branch-name-from-worktree>",
  "commits": ["<sha>", "<sha>"],
  "filesChanged": ["<path>", ...]
}
```

If you cannot complete, emit `<coder-blocked>` plus a one-line reason; do NOT emit the JSON block.
```

- [ ] **Step 2: Write failing test**

`apps/orchestrator/test/agents/code.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { runCode } from "../../src/agents/code.js";

describe("runCode", () => {
  it("parses coder JSON and returns branch/commits", async () => {
    const finalText = `<coder-complete>\n\`\`\`json\n${JSON.stringify({
      branch: "feat/x",
      commits: ["abc1234", "def5678"],
      filesChanged: ["src/a.ts", "tests/a.test.ts"],
    })}\n\`\`\``;

    const session = {
      prompt: vi.fn(async () => ({
        finalText,
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.01,
      })),
      close: vi.fn(async () => {}),
    };

    const result = await runCode({
      taskId: "t-1",
      cwd: "/tmp/wt",
      onEvent: () => {},
      createSession: async () => session,
      readPlan: async () => ({
        goal: "x",
        patternsToFollow: [],
        touchpoints: [],
        blastRadius: [],
        precedentWarnings: [],
        steps: [{ id: "s1", title: "t", files: [], assertion: "a" }],
        verificationScenarios: { scenarios: [] },
        outOfScope: [],
        suggestedWorkflow: "backend-feature",
      }),
      retryHint: undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.branch).toBe("feat/x");
    expect(result.commits).toEqual(["abc1234", "def5678"]);
  });

  it("returns ok:false when coder emits <coder-blocked>", async () => {
    const session = {
      prompt: vi.fn(async () => ({
        finalText: "<coder-blocked>\nplan step s2 references nonexistent file",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.01,
      })),
      close: vi.fn(async () => {}),
    };

    const result = await runCode({
      taskId: "t-1",
      cwd: "/tmp/wt",
      onEvent: () => {},
      createSession: async () => session,
      readPlan: async () => ({
        goal: "x",
        patternsToFollow: [],
        touchpoints: [],
        blastRadius: [],
        precedentWarnings: [],
        steps: [],
        verificationScenarios: { scenarios: [] },
        outOfScope: [],
        suggestedWorkflow: "backend-feature",
      }),
      retryHint: undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("blocked");
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test agents/code`
Expected: FAIL.

- [ ] **Step 4: Implement `src/agents/code.ts`**

`apps/orchestrator/src/agents/code.ts`:
```typescript
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { PiSession, PiBridgeEvent } from "@pi-harness/pi-bridge";
import type { PlanArtifact } from "@pi-harness/shared";

const SYSTEM_PATH = resolve(import.meta.dirname ?? __dirname, "prompts", "code.md");

const CoderResultSchema = z.object({
  branch: z.string().min(1),
  commits: z.array(z.string()),
  filesChanged: z.array(z.string()),
});
export type CoderEmitted = z.infer<typeof CoderResultSchema>;

export type CodeOpts = {
  taskId: string;
  cwd: string;
  onEvent: (e: PiBridgeEvent) => void;
  createSession: (opts: {
    cwd: string;
    systemPrompt?: string;
    onEvent: (e: PiBridgeEvent) => void;
  }) => Promise<PiSession>;
  readPlan: (taskId: string) => Promise<PlanArtifact>;
  // If present, this is a verifier-failure-driven retry; gets pasted as a
  // follow-up turn so the coder fixes only the failing scope.
  retryHint?: { scenarioId: string; expected: string; actual: string };
};

export type CodeResult = {
  ok: boolean;
  branch?: string;
  commits?: string[];
  filesChanged?: string[];
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
};

export async function runCode(opts: CodeOpts): Promise<CodeResult> {
  const plan = await opts.readPlan(opts.taskId);
  const systemPrompt = await readFile(SYSTEM_PATH, "utf8");
  const session = await opts.createSession({
    cwd: opts.cwd,
    systemPrompt,
    onEvent: opts.onEvent,
  });

  try {
    const userMessage = opts.retryHint
      ? buildRetryMessage(opts.retryHint)
      : buildInitialMessage(plan);

    const result = await session.prompt(userMessage);

    if (result.finalText.includes("<coder-blocked>")) {
      const reason = result.finalText.split("<coder-blocked>")[1]?.trim().split("\n")[0];
      return {
        ok: false,
        costUsd: result.costUsd,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        error: `coder blocked: ${reason ?? "no reason given"}`,
      };
    }

    const parsed = parseCoderJson(result.finalText);
    if (!parsed.ok) {
      return {
        ok: false,
        costUsd: result.costUsd,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        error: parsed.error,
      };
    }
    return {
      ok: true,
      branch: parsed.value.branch,
      commits: parsed.value.commits,
      filesChanged: parsed.value.filesChanged,
      costUsd: result.costUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  } finally {
    await session.close();
  }
}

function buildInitialMessage(plan: PlanArtifact): string {
  return `## Plan\n\n${JSON.stringify(plan, null, 2)}\n\n## Instruction\n\nImplement every step. TDD per step. One commit per step. Emit <coder-complete> + JSON when done.`;
}

function buildRetryMessage(hint: { scenarioId: string; expected: string; actual: string }): string {
  return [
    `## Verification failure`,
    ``,
    `Scenario: \`${hint.scenarioId}\``,
    `Expected: ${hint.expected}`,
    `Actual:   ${hint.actual}`,
    ``,
    `Fix only the failing scope. Re-emit <coder-complete> + JSON.`,
  ].join("\n");
}

function parseCoderJson(text: string): { ok: true; value: CoderEmitted } | { ok: false; error: string } {
  const sentinel = text.indexOf("<coder-complete>");
  if (sentinel === -1) return { ok: false, error: "missing <coder-complete> sentinel" };
  const m = text.slice(sentinel).match(/```json\s*([\s\S]+?)\s*```/);
  if (!m) return { ok: false, error: "missing ```json block" };
  try {
    return { ok: true, value: CoderResultSchema.parse(JSON.parse(m[1]!)) };
  } catch (e) {
    return { ok: false, error: `parse error: ${(e as Error).message}` };
  }
}
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test agents/code`
Expected: PASS — 2 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/orchestrator/src/agents/code.ts apps/orchestrator/src/agents/prompts/code.md apps/orchestrator/test/agents/code.test.ts
git commit -m "feat(orchestrator): Coder Agent driver + retry path"
```

---

## Task 10: Verifier — scenario runner (api scenarios)

The Verifier doesn't use a pi session for scenario execution — it runs them directly. (The Verifier *Agent* prompt exists for the orchestration layer that decides scenario order, but the actual hits are executed by typed code so we control timeouts and capture exactly what we need.)

This task implements the api-scenario path; UI scenarios land in Task 11.

**Files:**
- Create: `apps/orchestrator/src/agents/verify-runner.ts`, `apps/orchestrator/test/agents/verify-runner.test.ts`

- [ ] **Step 1: Write failing test (uses a real ephemeral http server in-test)**

`apps/orchestrator/test/agents/verify-runner.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runApiScenario } from "../../src/agents/verify-runner.js";

let server: Server;
let port = 0;
let proofDir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/ok" && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ received: true }));
      return;
    }
    if (req.url === "/bad") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad_signature" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as { port: number }).port;
  proofDir = await mkdtemp(join(tmpdir(), "proof-"));
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(proofDir, { recursive: true, force: true });
});

describe("runApiScenario", () => {
  it("passes when expected status matches", async () => {
    const result = await runApiScenario({
      scenario: {
        id: "ok-200",
        type: "api",
        name: "ok",
        request: { method: "POST", url: `http://127.0.0.1:${port}/ok`, body: {} },
        expect: { status: 200, body_contains: ["received"] },
      },
      proofDir,
    });
    expect(result.ok).toBe(true);
    expect(result.evidence.status).toBe(200);
    expect(result.evidence.responseFile).toBeDefined();

    const responseBody = await readFile(
      join(proofDir, "responses", "ok-200.json"),
      "utf8",
    );
    expect(responseBody).toContain("received");
  });

  it("fails when status doesn't match", async () => {
    const result = await runApiScenario({
      scenario: {
        id: "wrong-status",
        type: "api",
        name: "wrong",
        request: { method: "POST", url: `http://127.0.0.1:${port}/ok`, body: {} },
        expect: { status: 201 },
      },
      proofDir,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("status");
  });

  it("fails when body_contains is missing", async () => {
    const result = await runApiScenario({
      scenario: {
        id: "no-keyword",
        type: "api",
        name: "x",
        request: { method: "POST", url: `http://127.0.0.1:${port}/ok`, body: {} },
        expect: { status: 200, body_contains: ["nope"] },
      },
      proofDir,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("body_contains");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test verify-runner`
Expected: FAIL.

- [ ] **Step 3: Implement `src/agents/verify-runner.ts`**

`apps/orchestrator/src/agents/verify-runner.ts`:
```typescript
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApiScenario, ScenarioResult } from "@pi-harness/shared";

// Runs a single api scenario against a live HTTP endpoint. Writes the response
// body to <proofDir>/responses/<id>.json regardless of pass/fail (the
// dashboard's verification panel renders this).
export async function runApiScenario(opts: {
  scenario: ApiScenario;
  proofDir: string;
}): Promise<ScenarioResult> {
  const { scenario, proofDir } = opts;
  const start = Date.now();

  let response: Response;
  try {
    response = await fetch(scenario.request.url, {
      method: scenario.request.method,
      headers: scenario.request.headers,
      body: scenario.request.body !== undefined ? JSON.stringify(scenario.request.body) : undefined,
    });
  } catch (e) {
    return {
      id: scenario.id,
      type: "api",
      ok: false,
      error: `network: ${(e as Error).message}`,
      evidence: {},
      durationMs: Date.now() - start,
    };
  }

  const bodyText = await response.text();
  const responsesDir = join(proofDir, "responses");
  await mkdir(responsesDir, { recursive: true });
  const responseFile = join("responses", `${scenario.id}.json`);
  await writeFile(join(proofDir, responseFile), bodyText);

  if (response.status !== scenario.expect.status) {
    return {
      id: scenario.id,
      type: "api",
      ok: false,
      error: `expected status ${scenario.expect.status}, got ${response.status}`,
      evidence: { status: response.status, responseFile },
      durationMs: Date.now() - start,
    };
  }

  if (scenario.expect.body_contains?.length) {
    for (const needle of scenario.expect.body_contains) {
      if (!bodyText.includes(needle)) {
        return {
          id: scenario.id,
          type: "api",
          ok: false,
          error: `body_contains failed: missing "${needle}"`,
          evidence: { status: response.status, responseFile },
          durationMs: Date.now() - start,
        };
      }
    }
  }

  return {
    id: scenario.id,
    type: "api",
    ok: true,
    evidence: { status: response.status, responseFile },
    durationMs: Date.now() - start,
  };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test verify-runner`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/agents/verify-runner.ts apps/orchestrator/test/agents/verify-runner.test.ts
git commit -m "feat(orchestrator): api scenario runner"
```

---

## Task 11: Verifier — UI scenarios via Playwright

Adds `runUiScenario()` and `runUiVisualScenario()` driving real headless Chromium. Tested against a tiny static html served from disk.

**Files:**
- Modify: `apps/orchestrator/src/agents/verify-runner.ts`
- Create: `apps/orchestrator/test/agents/verify-runner-ui.test.ts`, `apps/orchestrator/test/fixtures/ui/index.html`

- [ ] **Step 1: Add `playwright` dependency**

Edit `apps/orchestrator/package.json` to add under `dependencies`:
```json
"playwright": "^1.48.0"
```
Then:
```bash
pnpm --filter @pi-harness/orchestrator install
pnpm --filter @pi-harness/orchestrator exec playwright install chromium
```

- [ ] **Step 2: Create test fixture html**

`apps/orchestrator/test/fixtures/ui/index.html`:
```html
<!doctype html>
<html><body>
  <h1>login</h1>
  <input name="email" />
  <input name="password" type="password" />
  <button type="button" onclick="window.location.hash='#dashboard'">log in</button>
  <div id="status">idle</div>
</body></html>
```

- [ ] **Step 3: Write failing test**

`apps/orchestrator/test/agents/verify-runner-ui.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runUiScenario, runUiVisualScenario } from "../../src/agents/verify-runner.js";

let server: Server;
let port = 0;
let proofDir: string;

beforeAll(async () => {
  server = createServer(async (_req, res) => {
    const html = await readFile(join(__dirname, "..", "fixtures", "ui", "index.html"));
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as { port: number }).port;
  proofDir = await mkdtemp(join(tmpdir(), "ui-proof-"));
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(proofDir, { recursive: true, force: true });
});

describe("runUiScenario (Playwright)", () => {
  it("walks steps, asserts url, captures screenshot", async () => {
    const result = await runUiScenario({
      scenario: {
        id: "login-success",
        type: "ui",
        name: "login flow",
        steps: [
          { navigate: `http://127.0.0.1:${port}/` },
          { fill: { selector: "input[name=email]", value: "u@x" } },
          { fill: { selector: "input[name=password]", value: "p" } },
          { click: "button[type=button]" },
          { wait_for_url: "**#dashboard" },
        ],
        expect: { url_matches: "**#dashboard", screenshot: "login.png" },
      },
      proofDir,
    });
    expect(result.ok).toBe(true);
    expect(result.evidence.screenshotFile).toContain("login.png");
  });

  it("ui-visual scenario captures the named file", async () => {
    const result = await runUiVisualScenario({
      scenario: {
        id: "home-shot",
        type: "ui-visual",
        name: "home",
        steps: [{ navigate: `http://127.0.0.1:${port}/` }],
        capture: { full_page: true, filename: "home.png" },
      },
      proofDir,
    });
    expect(result.ok).toBe(true);
    expect(result.evidence.screenshotFile).toContain("home.png");
  });
});
```

- [ ] **Step 4: Run, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test verify-runner-ui`
Expected: FAIL — `runUiScenario` not exported.

- [ ] **Step 5: Append UI runners to `src/agents/verify-runner.ts`**

Append:
```typescript
import { chromium, type Page } from "playwright";
import type { UiScenario, UiVisualScenario, UiStep } from "@pi-harness/shared";

async function walkSteps(page: Page, steps: UiStep[]): Promise<void> {
  for (const step of steps) {
    if ("navigate" in step) await page.goto(step.navigate);
    else if ("fill" in step) await page.fill(step.fill.selector, step.fill.value);
    else if ("click" in step) await page.click(step.click);
    else if ("wait_for_url" in step) await page.waitForURL(step.wait_for_url);
  }
}

export async function runUiScenario(opts: {
  scenario: UiScenario;
  proofDir: string;
}): Promise<ScenarioResult> {
  const { scenario, proofDir } = opts;
  const start = Date.now();
  const screenshotName = scenario.expect.screenshot ?? `${scenario.id}.png`;
  const screenshotFile = join("screenshots", screenshotName);
  await mkdir(join(proofDir, "screenshots"), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await walkSteps(page, scenario.steps);

    if (scenario.expect.url_matches) {
      // wait_for_url usually already satisfied this, but assert explicitly.
      const url = page.url();
      const matched = matchesGlob(url, scenario.expect.url_matches);
      if (!matched) {
        await page.screenshot({ path: join(proofDir, screenshotFile), fullPage: false });
        return {
          id: scenario.id,
          type: "ui",
          ok: false,
          error: `url_matches failed: ${url} !~ ${scenario.expect.url_matches}`,
          evidence: { screenshotFile },
          durationMs: Date.now() - start,
        };
      }
    }

    await page.screenshot({ path: join(proofDir, screenshotFile), fullPage: false });

    return {
      id: scenario.id,
      type: "ui",
      ok: true,
      evidence: { screenshotFile },
      durationMs: Date.now() - start,
    };
  } finally {
    await browser.close();
  }
}

export async function runUiVisualScenario(opts: {
  scenario: UiVisualScenario;
  proofDir: string;
}): Promise<ScenarioResult> {
  const { scenario, proofDir } = opts;
  const start = Date.now();
  const screenshotFile = join("screenshots", scenario.capture.filename);
  await mkdir(join(proofDir, "screenshots"), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await walkSteps(page, scenario.steps);

    if (scenario.capture.selector) {
      const handle = await page.locator(scenario.capture.selector);
      await handle.screenshot({ path: join(proofDir, screenshotFile) });
    } else {
      await page.screenshot({
        path: join(proofDir, screenshotFile),
        fullPage: scenario.capture.full_page === true,
      });
    }
    return {
      id: scenario.id,
      type: "ui-visual",
      ok: true,
      evidence: { screenshotFile },
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      id: scenario.id,
      type: "ui-visual",
      ok: false,
      error: (e as Error).message,
      evidence: {},
      durationMs: Date.now() - start,
    };
  } finally {
    await browser.close();
  }
}

// Tiny glob matcher — handles `**` for any-segments, no other wildcards.
function matchesGlob(url: string, pattern: string): boolean {
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*") +
      "$",
  );
  return re.test(url);
}
```

- [ ] **Step 6: Run, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test verify-runner-ui`
Expected: PASS — 2 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/orchestrator/src/agents/verify-runner.ts apps/orchestrator/test/agents/verify-runner-ui.test.ts apps/orchestrator/test/fixtures
git commit -m "feat(orchestrator): UI + ui-visual scenario runners (Playwright)"
```

---

## Task 12: Verifier Agent driver — orchestrate scenarios + write proof report

Reads the plan's `verificationScenarios`, runs each through the right runner, aggregates into a `ProofReport`, persists via `ArtifactsStore`. Returns ok/fail to the orchestrator.

**Files:**
- Create: `apps/orchestrator/src/agents/prompts/verify.md` (mostly documentation; the Verifier is code-driven), `apps/orchestrator/src/agents/verify.ts`, `apps/orchestrator/test/agents/verify.test.ts`

- [ ] **Step 1: Create `prompts/verify.md`**

`apps/orchestrator/src/agents/prompts/verify.md`:
```markdown
# Verifier Agent (system context)

The Verifier phase is **not** an LLM-driven loop. The orchestrator's `runVerify()` function runs scenarios directly through typed runners (api / ui / ui-visual). This file exists so the dashboard's "phase prompt" panel and the agent log have a system-prompt artifact to render and so a future Verifier-as-LLM mode (where the agent decides scenario order or skips) has a place to land.

## Today's behavior

- Read `.harness/runs/<task-id>/plan.json`.
- Boot the app under test using `.harness/start.sh` (if present) else `pnpm dev`.
- Wait for `:<port>/healthz` for up to 30s.
- Run every scenario in the plan's `verificationScenarios`. Continue on failure (collect every result).
- Write `.harness/runs/<task-id>/proof/proof-report.{json,md}`.
- Return ok = (every scenario.ok === true).
```

- [ ] **Step 2: Write failing test**

`apps/orchestrator/test/agents/verify.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { runVerify } from "../../src/agents/verify.js";
import type { ArtifactsStore } from "../../src/agents/artifacts-store.js";

describe("runVerify", () => {
  it("runs every scenario and writes a proof report", async () => {
    const readPlan = vi.fn(async () => ({
      goal: "x",
      patternsToFollow: [],
      touchpoints: [],
      blastRadius: [],
      precedentWarnings: [],
      steps: [],
      verificationScenarios: {
        scenarios: [
          {
            id: "a",
            type: "api" as const,
            name: "a",
            request: { method: "GET", url: "http://x/y" },
            expect: { status: 200 },
          },
          {
            id: "b",
            type: "api" as const,
            name: "b",
            request: { method: "GET", url: "http://x/y" },
            expect: { status: 200 },
          },
        ],
      },
      outOfScope: [],
      suggestedWorkflow: "backend-feature" as const,
    }));
    const writeProofReport = vi.fn(async () => {});
    const store = { readPlan, writeProofReport, proofDir: () => "/tmp/proof" } as unknown as ArtifactsStore;

    const runApiScenario = vi.fn(async (o: { scenario: { id: string } }) => ({
      id: o.scenario.id,
      type: "api" as const,
      ok: true,
      evidence: { status: 200 },
    }));

    const result = await runVerify({
      taskId: "t-1",
      runId: "r-1",
      store,
      runApiScenario,
      runUiScenario: async () => ({ id: "x", type: "ui", ok: false, evidence: {} }),
      runUiVisualScenario: async () => ({ id: "x", type: "ui-visual", ok: false, evidence: {} }),
    });

    expect(runApiScenario).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    expect(writeProofReport).toHaveBeenCalledOnce();
    const writtenReport = writeProofReport.mock.calls[0]![1] as { ok: boolean; scenarios: { id: string }[] };
    expect(writtenReport.scenarios).toHaveLength(2);
  });

  it("returns ok:false when any scenario fails", async () => {
    const readPlan = vi.fn(async () => ({
      goal: "x",
      patternsToFollow: [],
      touchpoints: [],
      blastRadius: [],
      precedentWarnings: [],
      steps: [],
      verificationScenarios: {
        scenarios: [
          {
            id: "a",
            type: "api" as const,
            name: "a",
            request: { method: "GET", url: "http://x" },
            expect: { status: 200 },
          },
        ],
      },
      outOfScope: [],
      suggestedWorkflow: "backend-feature" as const,
    }));
    const writeProofReport = vi.fn(async () => {});
    const store = { readPlan, writeProofReport, proofDir: () => "/tmp" } as unknown as ArtifactsStore;

    const result = await runVerify({
      taskId: "t-1",
      runId: "r-1",
      store,
      runApiScenario: async () => ({ id: "a", type: "api", ok: false, error: "x", evidence: {} }),
      runUiScenario: async () => ({ id: "x", type: "ui", ok: false, evidence: {} }),
      runUiVisualScenario: async () => ({ id: "x", type: "ui-visual", ok: false, evidence: {} }),
    });

    expect(result.ok).toBe(false);
    expect(result.firstFailure?.id).toBe("a");
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test agents/verify`
Expected: FAIL.

- [ ] **Step 4: Implement `src/agents/verify.ts`**

`apps/orchestrator/src/agents/verify.ts`:
```typescript
import type {
  ApiScenario,
  UiScenario,
  UiVisualScenario,
  ScenarioResult,
} from "@pi-harness/shared";
import type { ArtifactsStore } from "./artifacts-store.js";

type RunApi = (o: { scenario: ApiScenario; proofDir: string }) => Promise<ScenarioResult>;
type RunUi = (o: { scenario: UiScenario; proofDir: string }) => Promise<ScenarioResult>;
type RunUiVisual = (o: { scenario: UiVisualScenario; proofDir: string }) => Promise<ScenarioResult>;

export type VerifyOpts = {
  taskId: string;
  runId: string;
  store: ArtifactsStore;
  runApiScenario: RunApi;
  runUiScenario: RunUi;
  runUiVisualScenario: RunUiVisual;
};

export type VerifyResult = {
  ok: boolean;
  scenarios: ScenarioResult[];
  firstFailure?: ScenarioResult;
};

export async function runVerify(opts: VerifyOpts): Promise<VerifyResult> {
  const plan = await opts.store.readPlan(opts.taskId);
  const proofDir = opts.store.proofDir(opts.taskId);

  const results: ScenarioResult[] = [];
  for (const scenario of plan.verificationScenarios.scenarios) {
    let r: ScenarioResult;
    if (scenario.type === "api") r = await opts.runApiScenario({ scenario, proofDir });
    else if (scenario.type === "ui") r = await opts.runUiScenario({ scenario, proofDir });
    else r = await opts.runUiVisualScenario({ scenario, proofDir });
    results.push(r);
  }

  const ok = results.every((r) => r.ok);
  await opts.store.writeProofReport(opts.taskId, {
    runId: opts.runId,
    ok,
    scenarios: results,
    endedAt: new Date().toISOString(),
  });

  return { ok, scenarios: results, firstFailure: results.find((r) => !r.ok) };
}
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test agents/verify`
Expected: PASS — 2 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/orchestrator/src/agents/verify.ts apps/orchestrator/src/agents/prompts/verify.md apps/orchestrator/test/agents/verify.test.ts
git commit -m "feat(orchestrator): Verifier driver — orchestrates scenarios + writes proof"
```

---

## Task 13: PR Agent driver

Reads the plan + proof report, builds a PR body, opens it via `gh pr create`. Conventional commit prefixes are determined from the commit messages the Coder produced. Mocks `child_process.spawn` for the test.

**Files:**
- Create: `apps/orchestrator/src/agents/prompts/pr.md`, `apps/orchestrator/src/agents/pr.ts`, `apps/orchestrator/test/agents/pr.test.ts`

- [ ] **Step 1: Create `prompts/pr.md`**

`apps/orchestrator/src/agents/prompts/pr.md`:
```markdown
# PR Agent (system context)

Like the Verifier, the PR phase is code-driven, not LLM-driven. `runPr()`:

1. Read `.harness/runs/<task-id>/plan.json` and `proof/proof-report.json`.
2. Build the PR title from the brainstorm goal, in conventional-commit style (`feat:`, `fix:`, etc — derived from the dominant prefix in the Coder's commit log).
3. Build the PR body by templating: `## Summary` (goal + 2-3 bullets), `## Plan` (link to plan.md), `## Verification` (link to proof-report.md + green checkmarks per scenario), `## Test plan` (the scenario list).
4. Push the branch and call `gh pr create --title ... --body @body.md`.
5. Return the PR URL.

Failure modes: `gh` not installed, network error, no remote configured. All surface as `runPr().error`.
```

- [ ] **Step 2: Write failing test**

`apps/orchestrator/test/agents/pr.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { runPr } from "../../src/agents/pr.js";
import type { ArtifactsStore } from "../../src/agents/artifacts-store.js";

describe("runPr", () => {
  it("opens a PR with conventional title + templated body", async () => {
    const exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "push") return { ok: true, stdout: "" };
      if (cmd === "gh" && args[0] === "pr" && args[1] === "create") {
        return { ok: true, stdout: "https://github.com/x/y/pull/42\n" };
      }
      return { ok: false, stdout: "", stderr: "unexpected" };
    });

    const store = {
      readPlan: vi.fn(async () => ({
        goal: "Retry webhooks bounded.",
        patternsToFollow: [],
        touchpoints: [],
        blastRadius: [],
        precedentWarnings: [],
        steps: [],
        verificationScenarios: { scenarios: [] },
        outOfScope: [],
        suggestedWorkflow: "backend-feature" as const,
      })),
      readProofReport: vi.fn(async () => ({
        runId: "r1",
        ok: true,
        scenarios: [{ id: "ok", type: "api" as const, ok: true, evidence: {} }],
      })),
    } as unknown as ArtifactsStore;

    const result = await runPr({
      taskId: "t-1",
      branch: "feat/retry",
      cwd: "/tmp/wt",
      store,
      exec,
    });

    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://github.com/x/y/pull/42");

    const ghCall = exec.mock.calls.find((c) => c[0] === "gh");
    expect(ghCall?.[1].slice(0, 2)).toEqual(["pr", "create"]);
    const titleIdx = ghCall![1].indexOf("--title");
    expect(ghCall![1][titleIdx + 1]).toMatch(/^feat: /);
  });

  it("returns ok:false when gh push fails", async () => {
    const exec = vi.fn(async (cmd: string) => {
      if (cmd === "git") return { ok: false, stdout: "", stderr: "no remote" };
      return { ok: true, stdout: "" };
    });

    const store = {
      readPlan: vi.fn(async () => ({
        goal: "x",
        patternsToFollow: [],
        touchpoints: [],
        blastRadius: [],
        precedentWarnings: [],
        steps: [],
        verificationScenarios: { scenarios: [] },
        outOfScope: [],
        suggestedWorkflow: "backend-feature" as const,
      })),
      readProofReport: vi.fn(async () => ({
        runId: "r1", ok: true, scenarios: [],
      })),
    } as unknown as ArtifactsStore;

    const result = await runPr({
      taskId: "t",
      branch: "b",
      cwd: "/tmp",
      store,
      exec,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no remote");
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test agents/pr`
Expected: FAIL.

- [ ] **Step 4: Implement `src/agents/pr.ts`**

`apps/orchestrator/src/agents/pr.ts`:
```typescript
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtifactsStore } from "./artifacts-store.js";

type ExecResult = { ok: boolean; stdout: string; stderr?: string };
type Exec = (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<ExecResult>;

export type PrOpts = {
  taskId: string;
  branch: string;
  cwd: string;
  store: ArtifactsStore;
  exec: Exec;
};

export type PrResult = { ok: true; url: string } | { ok: false; error: string };

export async function runPr(opts: PrOpts): Promise<PrResult> {
  const plan = await opts.store.readPlan(opts.taskId);
  const proof = await opts.store.readProofReport(opts.taskId);

  // 1. Push the branch.
  const push = await opts.exec("git", ["push", "-u", "origin", opts.branch], { cwd: opts.cwd });
  if (!push.ok) return { ok: false, error: `git push failed: ${push.stderr ?? "unknown"}` };

  // 2. Build the PR body in a temp file (gh pr create body via @file).
  const title = derivePrTitle(plan.goal);
  const body = buildPrBody(plan, proof);
  const tmpDir = await mkdtemp(join(tmpdir(), "pr-body-"));
  const bodyFile = join(tmpDir, "body.md");
  try {
    await writeFile(bodyFile, body);

    const ghArgs = ["pr", "create", "--title", title, "--body", body, "--head", opts.branch];
    const gh = await opts.exec("gh", ghArgs, { cwd: opts.cwd });
    if (!gh.ok) return { ok: false, error: `gh pr create failed: ${gh.stderr ?? "unknown"}` };

    const url = gh.stdout.trim().split("\n").pop() ?? "";
    return { ok: true, url };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// "Retry webhooks bounded." → "feat: retry webhooks bounded"
// (default to feat:; v1.5 derives prefix from commit messages.)
function derivePrTitle(goal: string): string {
  const trimmed = goal.replace(/\.$/, "");
  const lower = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  return `feat: ${lower}`;
}

function buildPrBody(
  plan: { goal: string; verificationScenarios: { scenarios: { id: string; name: string }[] } },
  proof: { ok: boolean; scenarios: { id: string; ok: boolean; type: string }[] },
): string {
  const summary = `## Summary\n\n${plan.goal}\n`;
  const scenarioBullets = proof.scenarios.map(
    (s) => `- ${s.ok ? "✅" : "❌"} \`${s.id}\` (${s.type})`,
  );
  const verification = `## Verification\n\n${proof.ok ? "All scenarios green." : "Failures present."}\n\n${scenarioBullets.join("\n")}\n`;
  const planLink = `## Plan\n\nSee \`.harness/runs/<task-id>/plan.md\`.\n`;
  return [summary, planLink, verification].join("\n");
}
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test agents/pr`
Expected: PASS — 2 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/orchestrator/src/agents/pr.ts apps/orchestrator/src/agents/prompts/pr.md apps/orchestrator/test/agents/pr.test.ts
git commit -m "feat(orchestrator): PR Agent driver"
```

---

## Task 14: Replace `phase-prompts.ts` stubs with real wiring

Plan 2 left `getPromptFor(phase)` returning literal `[plan-3 will provide...]` strings. Now we replace it with a small dispatch that calls into the agent drivers.

The shape of `phase-prompts.ts` is no longer "return system+user strings" — it's "given a phase and context, run the right driver." Renaming it would break Plan 2's wiring, so we keep the filename and change the export.

**Files:**
- Modify: `apps/orchestrator/src/runner/phase-prompts.ts`, `apps/orchestrator/src/runner/run-loop.ts`

- [ ] **Step 1: Read current `phase-prompts.ts`**

It currently exports `getPromptFor(phase): { system, user }` — used in run-loop. We deprecate that and add a new export.

- [ ] **Step 2: Replace `phase-prompts.ts`**

`apps/orchestrator/src/runner/phase-prompts.ts`:
```typescript
import type { Phase } from "@pi-harness/shared";
import type { PiBridgeEvent, PiSession, PiSubagentSpec, PiSubagentResult } from "@pi-harness/pi-bridge";
import type { ArtifactsStore } from "../agents/artifacts-store.js";
import { runBrainstorm } from "../agents/brainstorm.js";
import { runPlan } from "../agents/plan.js";
import { runCode } from "../agents/code.js";
import { runVerify } from "../agents/verify.js";
import { runPr } from "../agents/pr.js";
import { fanoutResearch } from "../agents/plan-fanout.js";
import { runApiScenario, runUiScenario, runUiVisualScenario } from "../agents/verify-runner.js";

// Common deps every phase needs. The orchestrator constructs this once and
// passes it into runPhase.
export type PhaseDeps = {
  cwd: string;
  onEvent: (e: PiBridgeEvent) => void;
  createSession: (opts: {
    cwd: string;
    systemPrompt?: string;
    onEvent: (e: PiBridgeEvent) => void;
  }) => Promise<PiSession>;
  runSubagent: (spec: PiSubagentSpec) => Promise<PiSubagentResult>;
  store: ArtifactsStore;
  exec: (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<{ ok: boolean; stdout: string; stderr?: string }>;
};

export type PhaseInput = {
  taskId: string;
  runId: string;
  // Set when a phase rerun should reuse context (coder retry after verify fail).
  retryHint?: { scenarioId: string; expected: string; actual: string };
  ticketTitle?: string;
  ticketDescription?: string;
  branch?: string; // for pr phase
};

export type PhaseOutput = {
  ok: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  // Phase-specific extras the run-loop forwards into Task fields.
  branch?: string;
  prUrl?: string;
};

// Single dispatch point. The run-loop calls this per phase.
export async function runPhase(
  phase: Phase,
  input: PhaseInput,
  deps: PhaseDeps,
): Promise<PhaseOutput> {
  switch (phase) {
    case "brainstorm": {
      const r = await runBrainstorm({
        taskId: input.taskId,
        ticketTitle: input.ticketTitle ?? "(no title)",
        ticketDescription: input.ticketDescription ?? "",
        cwd: deps.cwd,
        onEvent: deps.onEvent,
        createSession: deps.createSession,
        store: deps.store,
      });
      return mapResult(r);
    }
    case "plan": {
      const r = await runPlan({
        taskId: input.taskId,
        cwd: deps.cwd,
        onEvent: deps.onEvent,
        createSession: deps.createSession,
        runSubagent: deps.runSubagent,
        fanoutResearch: ({ cwd, task, runSubagent }) =>
          fanoutResearch({ cwd, task, runSubagent }),
        store: deps.store,
      });
      return mapResultPlan(r);
    }
    case "code": {
      const r = await runCode({
        taskId: input.taskId,
        cwd: deps.cwd,
        onEvent: deps.onEvent,
        createSession: deps.createSession,
        readPlan: (id) => deps.store.readPlan(id),
        retryHint: input.retryHint,
      });
      return {
        ok: r.ok,
        costUsd: r.costUsd,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        error: r.error,
        branch: r.branch,
      };
    }
    case "verify": {
      const r = await runVerify({
        taskId: input.taskId,
        runId: input.runId,
        store: deps.store,
        runApiScenario: ({ scenario, proofDir }) => runApiScenario({ scenario, proofDir }),
        runUiScenario: ({ scenario, proofDir }) => runUiScenario({ scenario, proofDir }),
        runUiVisualScenario: ({ scenario, proofDir }) =>
          runUiVisualScenario({ scenario, proofDir }),
      });
      return {
        ok: r.ok,
        costUsd: 0, // verifier is code-only in v1
        inputTokens: 0,
        outputTokens: 0,
        error: r.firstFailure ? `scenario ${r.firstFailure.id} failed: ${r.firstFailure.error}` : undefined,
      };
    }
    case "pr": {
      if (!input.branch) {
        return { ok: false, costUsd: 0, inputTokens: 0, outputTokens: 0, error: "pr phase requires branch" };
      }
      const r = await runPr({
        taskId: input.taskId,
        branch: input.branch,
        cwd: deps.cwd,
        store: deps.store,
        exec: deps.exec,
      });
      if (r.ok) {
        return { ok: true, costUsd: 0, inputTokens: 0, outputTokens: 0, prUrl: r.url };
      }
      return { ok: false, costUsd: 0, inputTokens: 0, outputTokens: 0, error: r.error };
    }
  }
}

function mapResult(r: {
  ok: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}): PhaseOutput {
  return {
    ok: r.ok,
    costUsd: r.costUsd,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    error: r.error,
  };
}

function mapResultPlan(r: {
  ok: boolean;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  error?: string;
}): PhaseOutput {
  return {
    ok: r.ok,
    costUsd: r.totalCostUsd,
    inputTokens: r.totalInputTokens,
    outputTokens: r.totalOutputTokens,
    error: r.error,
  };
}
```

- [ ] **Step 3: Update `run-loop.ts` to call `runPhase` with the new signature**

Replace the relevant block in `apps/orchestrator/src/runner/run-loop.ts`. Since the run-loop now needs `PhaseDeps`, the loop signature grows to accept it:

```typescript
import { runPhase, type PhaseDeps } from "./phase-prompts.js";
// ... in RunLoopOpts add: phaseDeps: PhaseDeps; (and remove dispatcher)
// ... replace the dispatch call with:

const result = await runPhase(phase, {
  taskId: task.id,
  runId: run.id,
  ticketTitle: task.title,
  ticketDescription: task.description,
  branch: task.branchName ?? undefined,
}, opts.phaseDeps);
```

Then update the run row update:
```typescript
await runs.updateRun(run.id, {
  endedAt: new Date(),
  status: result.ok ? "succeeded" : "failed",
  error: result.error ?? null,
  inputTokens: result.inputTokens,
  outputTokens: result.outputTokens,
  costUsd: result.costUsd,
});
```

And if `result.branch` is set, persist on the task: `if (result.branch) await runs.updateTask(task.id, { branchName: result.branch });`

- [ ] **Step 4: Update `run-loop.test.ts` to use the new shape**

The Plan 2 test mocked `dispatcher.runPhase`. Adjust to mock `phaseDeps`:

```typescript
const phaseDeps: any = {
  // not all need to be real for the test
  cwd: "/tmp",
  onEvent: () => {},
  createSession: vi.fn(),
  runSubagent: vi.fn(),
  store: {} as any,
  exec: vi.fn(),
};
// And inject phaseDeps; replace dispatcher with phaseDeps in the runLoop call.
```

Or — simpler — mock `runPhase` itself by exporting it via a module replaceable seam. Easiest: add a default export and let the test re-import via vi.mock.

Actual test edit:
```typescript
import { vi } from "vitest";
vi.mock("../src/runner/phase-prompts.js", () => ({
  runPhase: vi.fn(async () => ({
    ok: true,
    costUsd: 0,
    inputTokens: 1,
    outputTokens: 1,
  })),
}));
```

- [ ] **Step 5: Run all orchestrator tests**

Run: `pnpm --filter @pi-harness/orchestrator test`
Expected: every existing test still passes; run-loop test still green.

- [ ] **Step 6: Commit**

```bash
git add apps/orchestrator/src/runner apps/orchestrator/test/run-loop.test.ts
git commit -m "feat(orchestrator): wire real phase drivers into runPhase dispatch"
```

---

## Task 15: Smoke verification — Plan 1 + Plan 2 + Plan 3

The end-of-plan gate.

- [ ] **Step 1: Full install + typecheck + build**

Run: `pnpm install && pnpm typecheck && pnpm build`
Expected: clean across all packages.

- [ ] **Step 2: Run all tests**

Run: `pnpm test`

Expected counts (cumulative):
- `@pi-harness/shared`: 8 (was 4, +4 from artifacts schema)
- `@pi-harness/db`: 2
- `@pi-harness/pi-bridge`: 1
- `@pi-harness/subagents`: 5 (was 3, +2 from ours/ resolution)
- `@pi-harness/orchestrator`: ~50 (was ~30, +brainstorm:2, +plan-fanout:3, +plan:1, +code:2, +verify-runner:3, +verify-runner-ui:2, +verify:2, +pr:2, +artifacts-store:2)

Total ≈ 65 tests.

If any fails, **stop and fix before Plan 4.**

- [ ] **Step 3: Tag the milestone**

```bash
git tag plan-3-agents-complete
```

---

## Self-Review

**Spec coverage**

| Spec section | Plan 3 task |
|---|---|
| §7.1 Planning Agent 7-phase pipeline | Tasks 7 (fanout), 8 (synthesis prompt + driver), Task 8's plan.md prompt requires claim-verifier dispatch and verification-author dispatch |
| §7.3 New subagents (verification-author, proof-capture, screenshot-taker) | Tasks 2, 3 |
| §8.2 Verifier captures evidence | Tasks 10, 11, 12 |
| §8.4 Three classes of evidence (test, functional, visual) | api scenarios cover test/functional; ui & ui-visual cover visual; project's own `pnpm test` runs as part of Coder phase per code.md prompt |
| §8.3 Hard fail with retry — Coder retry path | Task 9 (`retryHint` parameter; matching turn message format) |
| §9.3 Phase-driver agents (Brainstorm, Plan, Code, Verify, PR) | Tasks 6, 8, 9, 12, 13 |

**Mock coverage**

| Mock element | Plan 3 source |
|---|---|
| `brainstorm.html` chat bubbles | Task 6 — runBrainstorm streams `message_delta` events; transcript is in BrainstormArtifact |
| `brainstorm.html` Emerging Spec sections | Task 1 — BrainstormArtifact shape (goal, decisions, openQuestions) |
| `task-detail.html` agent log | Tasks 6, 8, 9 — every driver passes `onEvent` to pi-bridge → SSE |
| `verification.html` 24/24 unit | Coder's `pnpm test` invocation logs (events) |
| `verification.html` 3/3 functional | Task 12 ProofReport with api scenarios |
| `verification.html` Playwright screenshots | Task 11 ui/ui-visual scenarios → screenshots/ dir |
| `verification.html` "0.00% diff" badge | (deferred — visual diff is v1.5; v1 just captures + names) |

**Type consistency**

- All artifact shapes (`BrainstormArtifact`, `PlanArtifact`, `ProofReport`) come from `@pi-harness/shared`. Phase drivers, ArtifactsStore, dashboard (Plan 4) all import the same types.
- `ScenarioResult` is the unified output of all three runners. `ProofReport.scenarios` is exactly `ScenarioResult[]`.
- `PhaseOutput` is the contract between runner/run-loop and `runPhase` — every driver's return shape maps cleanly into it.

**Placeholder scan**

- One intentional v1.5 deferral: visual diff/baseline comparison (mock shows `✓ 0.00% diff`). v1 just captures the actual screenshot. No code says `TODO`.
- Conventional-commit prefix derivation in PR Agent is documented as "default to feat:; v1.5 derives from commits."

**Plan 3 → Plan 4 handoff**

Plan 4 (dashboard) consumes from this plan's outputs:
- `BrainstormArtifact` JSON for the Emerging Spec pane (the chat input/output is the SSE stream from Plan 2's `/api/runs/:id/events/stream`).
- `PlanArtifact` JSON for the plan-review form (sections, steps, scenarios are all typed).
- `ProofReport` JSON for the verification panel — every column in `verification.html` is a field here.
- The `.harness/runs/<task-id>/proof/screenshots/<filename>` files are served via a static route (Plan 4 task: add `/api/artifacts/:taskId/*` static handler).

The dashboard never calls drivers directly. It reads:
1. Tasks/runs/events from REST + SSE (Plan 2).
2. Artifact JSON files from a new GET `/api/artifacts/:taskId/:name` route (Plan 4 adds this on the orchestrator).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-08-pi-harness-03-agent-fleet.md`.**

Assumes Plans 1 + 2 executed. Tasks 10–11 require `playwright install chromium` (Task 11 step 1). Task 13 mocks `gh`/`git` exec — no live PR is created in tests.
