import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentSession,
  AgentSessionOptions,
} from "@pi-harness/pi-bridge";
import {
  PREFLIGHT_SUBAGENTS,
  runPreflight,
  type PreflightSubagentEvent,
} from "../../src/agents/plan-preflight.js";

let scratch: string;
let cwd: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "preflight-test-"));
  cwd = scratch;
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const baseOpts = (overrides: Partial<Parameters<typeof runPreflight>[0]> = {}) => ({
  cwd,
  taskId: "T-001",
  ticketTitle: "Add retry to webhooks",
  ticketDescription: "Bound retries to 5 with exponential backoff.",
  designBody: "# Design\n\nbody\n",
  specBody: "# Spec\n\nbody\n",
  phaseModel: {
    provider: "anthropic",
    model: "claude-opus-4-7",
    thinkingLevel: "high" as const,
    maxTurns: 20,
  },
  createAgentSession: makeFakeWriter(),
  onSubagentEvent: () => {},
  ...overrides,
});

// Fake createAgentSession factory: returns sessions whose .prompt() writes the
// expected findings file derived from the user prompt's "Write your findings
// to `<path>`" line, then resolves with synthetic usage. This lets tests
// drive 8 parallel subagents without the real SDK.
function makeFakeWriter(opts: {
  failSubagents?: Set<string>;
  delayMs?: number;
  onCreate?: () => void;
} = {}): (o: AgentSessionOptions) => Promise<AgentSession> {
  return async (sessionOpts) => {
    opts.onCreate?.();
    return {
      async prompt(text: string) {
        // Extract findings path from the prompt: matches the `Write your
        // findings to `<path>`` line that buildSubagentPrompt produces.
        const match = text.match(/Write your findings to `([^`]+)`/);
        if (!match) throw new Error("fake session: prompt missing findings path");
        const rel = match[1]!;
        const subagent = rel.split("/").pop()!.replace(/\.md$/, "");

        if (opts.failSubagents?.has(subagent)) {
          throw new Error(`synthetic failure for ${subagent}`);
        }

        if (opts.delayMs) {
          await new Promise((r) => setTimeout(r, opts.delayMs));
        }

        const abs = join(sessionOpts.cwd, rel);
        await writeFile(abs, `# ${subagent} findings\n\nfake findings body\n`);
        return { inputTokens: 100, outputTokens: 50, costUsd: 0.01 };
      },
      async abort() {},
      async close() {},
    } satisfies AgentSession;
  };
}

describe("runPreflight", () => {
  it("dispatches all 7 research subagents in parallel and writes findings", async () => {
    const events: PreflightSubagentEvent[] = [];
    const result = await runPreflight(
      baseOpts({
        onSubagentEvent: (e) => {
          events.push(e);
        },
      }),
    );

    expect(result.failed).toBe(false);
    expect(result.results.map((r) => r.subagent).sort()).toEqual(
      [...PREFLIGHT_SUBAGENTS].sort(),
    );
    expect(result.results.every((r) => r.ok)).toBe(true);

    for (const sa of PREFLIGHT_SUBAGENTS) {
      const body = await readFile(
        join(cwd, ".harness", "T-001", "research", `${sa}.md`),
        "utf8",
      );
      expect(body).toContain(`${sa} findings`);
    }

    // Each subagent emits exactly one started + one ended.
    const startedKinds = events.filter((e) => e.kind === "started");
    const endedKinds = events.filter((e) => e.kind === "ended");
    expect(startedKinds).toHaveLength(7);
    expect(endedKinds).toHaveLength(7);
  });

  it("dispatches subagents concurrently (all create() calls fire before any prompt resolves)", async () => {
    let createdCount = 0;
    const peakBeforeFirstResolve = { value: 0 };
    let firstResolved = false;

    const writer = makeFakeWriter({
      delayMs: 30,
      onCreate: () => {
        createdCount += 1;
        if (!firstResolved) {
          peakBeforeFirstResolve.value = Math.max(
            peakBeforeFirstResolve.value,
            createdCount,
          );
        }
      },
    });

    // Wrap to flip firstResolved when the first prompt completes.
    const wrapped: typeof writer = async (o) => {
      const s = await writer(o);
      const orig = s.prompt.bind(s);
      s.prompt = async (t) => {
        const r = await orig(t);
        firstResolved = true;
        return r;
      };
      return s;
    };

    await runPreflight(
      baseOpts({
        createAgentSession: wrapped,
        onSubagentEvent: () => {},
      }),
    );

    // All 7 sessions should be created before the first one resolves.
    expect(peakBeforeFirstResolve.value).toBe(7);
  });

  it("one subagent failure leaves the other six successful and below the failed threshold", async () => {
    const result = await runPreflight(
      baseOpts({
        createAgentSession: makeFakeWriter({
          failSubagents: new Set(["scope-tracer"]),
        }),
      }),
    );

    expect(result.failed).toBe(false); // 1 < 3
    const scope = result.results.find((r) => r.subagent === "scope-tracer")!;
    expect(scope.ok).toBe(false);
    expect(scope.error).toContain("synthetic failure");
    const others = result.results.filter((r) => r.subagent !== "scope-tracer");
    expect(others.every((r) => r.ok)).toBe(true);
  });

  it("≥3 subagent failures sets failed=true so caller can fail the phase", async () => {
    const result = await runPreflight(
      baseOpts({
        createAgentSession: makeFakeWriter({
          failSubagents: new Set([
            "scope-tracer",
            "codebase-locator",
            "codebase-pattern-finder",
          ]),
        }),
      }),
    );
    expect(result.failed).toBe(true);
  });

  it("re-entry skips subagents whose findings file already exists", async () => {
    // Pre-seed two findings files.
    const researchDir = join(cwd, ".harness", "T-001", "research");
    await mkdir(researchDir, { recursive: true });
    await writeFile(join(researchDir, "scope-tracer.md"), "# pre-existing\n");
    await writeFile(join(researchDir, "precedent-locator.md"), "# pre-existing\n");

    let createCount = 0;
    const events: PreflightSubagentEvent[] = [];
    const result = await runPreflight(
      baseOpts({
        createAgentSession: makeFakeWriter({
          onCreate: () => {
            createCount += 1;
          },
        }),
        onSubagentEvent: (e) => {
          events.push(e);
        },
      }),
    );

    // Only 5 of 7 should have been dispatched (scope-tracer + precedent-locator skipped).
    expect(createCount).toBe(5);
    expect(events.filter((e) => e.kind === "started")).toHaveLength(5);

    // All 7 still appear in results — the pre-existing ones are reported as ok with zero usage.
    expect(result.results).toHaveLength(7);
    const scope = result.results.find((r) => r.subagent === "scope-tracer")!;
    expect(scope.ok).toBe(true);
    expect(scope.costUsd).toBe(0);
    expect(scope.inputTokens).toBe(0);
  });
});
