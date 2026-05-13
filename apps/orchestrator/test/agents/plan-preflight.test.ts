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
  },
  createAgentSession: makeFakeWriter(),
  onSubagentEvent: () => {},
  ...overrides,
});

// Fake createAgentSession factory: returns sessions whose .prompt() invokes
// the wired `write_findings` custom tool (mirroring what the real SDK does)
// to persist a synthetic findings body, then resolves with synthetic usage.
// This lets tests drive parallel subagents without the real SDK.
function makeFakeWriter(opts: {
  failSubagents?: Set<string>;
  delayMs?: number;
  onCreate?: () => void;
  mode?: "write" | "skip-write" | "empty-write";
} = {}): (o: AgentSessionOptions) => Promise<AgentSession> {
  return async (sessionOpts) => {
    opts.onCreate?.();
    const writeFindings = (sessionOpts.customTools ?? []).find(
      (t) => t.name === "write_findings",
    ) as
      | (NonNullable<AgentSessionOptions["customTools"]>[number] & {
          __subagent: string;
        })
      | undefined;
    if (!writeFindings) {
      throw new Error("fake session: write_findings custom tool missing from session options");
    }
    const subagent = writeFindings.__subagent;
    return {
      async prompt(_text: string) {
        if (opts.failSubagents?.has(subagent)) {
          throw new Error(`synthetic failure for ${subagent}`);
        }
        if (opts.delayMs) {
          await new Promise((r) => setTimeout(r, opts.delayMs));
        }
        if (opts.mode !== "skip-write") {
          await writeFindings.execute(
            "test-write",
            {
              body: opts.mode === "empty-write"
                ? " \n"
                : `# ${subagent} findings\n\nfake findings body\n`,
            },
            undefined,
            undefined,
            undefined as never,
          );
        }
        return { inputTokens: 100, outputTokens: 50, costUsd: 0.01 };
      },
      async abort() {},
      async close() {},
    } satisfies AgentSession;
  };
}

function makeHangingWriter(opts: {
  onAbort?: () => void;
  rejectOnAbort?: boolean;
  onCreate?: () => void;
} = {}): (o: AgentSessionOptions) => Promise<AgentSession> {
  return async () => {
    opts.onCreate?.();
    let rejectPrompt: ((err: Error) => void) | null = null;
    return {
      async prompt() {
        return new Promise((_, reject) => {
          rejectPrompt = reject;
        });
      },
      async abort() {
        opts.onAbort?.();
        if (opts.rejectOnAbort) {
          rejectPrompt?.(new Error("aborted"));
        }
      },
      async close() {},
    } satisfies AgentSession;
  };
}

describe("runPreflight", () => {
  const N = PREFLIGHT_SUBAGENTS.length;
  const FIRST = PREFLIGHT_SUBAGENTS[0]!;

  it("dispatches every preflight subagent in parallel and writes findings", async () => {
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

    expect(events.filter((e) => e.kind === "started")).toHaveLength(N);
    expect(events.filter((e) => e.kind === "ended")).toHaveLength(N);
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

    expect(peakBeforeFirstResolve.value).toBe(N);
  });

  it("one required subagent failure makes preflight fail", async () => {
    const result = await runPreflight(
      baseOpts({
        createAgentSession: makeFakeWriter({
          failSubagents: new Set([FIRST]),
        }),
      }),
    );

    expect(result.failed).toBe(true);
    const failed = result.results.find((r) => r.subagent === FIRST)!;
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("synthetic failure");
    const others = result.results.filter((r) => r.subagent !== FIRST);
    expect(others.every((r) => r.ok)).toBe(true);
  });

  it("a session that returns without write_findings fails the subagent", async () => {
    const result = await runPreflight(
      baseOpts({
        createAgentSession: makeFakeWriter({ mode: "skip-write" }),
      }),
    );

    expect(result.failed).toBe(true);
    expect(result.results.every((r) => !r.ok)).toBe(true);
    expect(result.results[0]?.error).toContain("completed without writing findings");
  });

  it("an empty findings file fails the subagent", async () => {
    const result = await runPreflight(
      baseOpts({
        createAgentSession: makeFakeWriter({ mode: "empty-write" }),
      }),
    );

    expect(result.failed).toBe(true);
    expect(result.results.every((r) => !r.ok)).toBe(true);
    expect(result.results[0]?.error).toContain("completed without writing findings");
  });

  it("passes maxTurns to each preflight session", async () => {
    const maxTurns: number[] = [];
    const writer = makeFakeWriter({
      onCreate: () => {},
    });
    await runPreflight(
      baseOpts({
        createAgentSession: async (o) => {
          maxTurns.push(o.maxTurns ?? 0);
          return writer(o);
        },
      }),
    );

    expect(maxTurns).toEqual(Array.from({ length: N }, () => 12));
  });

  it("times out hanging subagents and aborts their sessions", async () => {
    let aborts = 0;
    const result = await runPreflight(
      baseOpts({
        createAgentSession: makeHangingWriter({
          onAbort: () => {
            aborts += 1;
          },
        }),
        subagentTimeoutMs: 5,
      }),
    );

    expect(result.failed).toBe(true);
    expect(aborts).toBe(N);
    expect(result.results.every((r) => r.error?.includes("timed out"))).toBe(true);
  });

  it("parent abort signal cancels in-flight subagents", async () => {
    const controller = new AbortController();
    let created = 0;
    let aborts = 0;
    const resultPromise = runPreflight(
      baseOpts({
        createAgentSession: makeHangingWriter({
          rejectOnAbort: true,
          onCreate: () => {
            created += 1;
            if (created === N) {
              setTimeout(() => controller.abort(), 0);
            }
          },
          onAbort: () => {
            aborts += 1;
          },
        }),
        signal: controller.signal,
        subagentTimeoutMs: 1000,
      }),
    );

    const result = await resultPromise;
    expect(result.failed).toBe(true);
    expect(aborts).toBe(N);
  });

  it("re-entry skips subagents whose findings file already exists", async () => {
    // Pre-seed one findings file.
    const researchDir = join(cwd, ".harness", "T-001", "research");
    await mkdir(researchDir, { recursive: true });
    await writeFile(join(researchDir, `${FIRST}.md`), "# pre-existing\n");

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

    expect(createCount).toBe(N - 1);
    expect(events.filter((e) => e.kind === "started")).toHaveLength(N - 1);
    expect(result.results).toHaveLength(N);
    const skipped = result.results.find((r) => r.subagent === FIRST)!;
    expect(skipped.ok).toBe(true);
    expect(skipped.costUsd).toBe(0);
    expect(skipped.inputTokens).toBe(0);
  });

  it("re-entry reruns subagents whose findings file is empty", async () => {
    const researchDir = join(cwd, ".harness", "T-001", "research");
    await mkdir(researchDir, { recursive: true });
    await writeFile(join(researchDir, `${FIRST}.md`), " \n");

    let createCount = 0;
    const result = await runPreflight(
      baseOpts({
        createAgentSession: makeFakeWriter({
          onCreate: () => {
            createCount += 1;
          },
        }),
      }),
    );

    expect(result.failed).toBe(false);
    expect(createCount).toBe(N);
    const body = await readFile(join(researchDir, `${FIRST}.md`), "utf8");
    expect(body).toContain(`${FIRST} findings`);
  });

  it("inlines the ticket digest, not the full design/spec, into the user prompt", async () => {
    let captured = "";
    const writer = makeFakeWriter();
    const wrapped: typeof writer = async (o) => {
      const s = await writer(o);
      const orig = s.prompt.bind(s);
      s.prompt = async (t) => {
        if (!captured) captured = t;
        return orig(t);
      };
      return s;
    };

    const designSentinel = "DESIGN_BODY_SHOULD_NOT_APPEAR_VERBATIM_IN_PROMPT";
    const designBody = `# Design\n\n## Goals\n\n- Cancel runs cleanly.\n\n## Trade-offs\n\n${designSentinel}\n`;
    const specBody = `# Spec\n\n## Acceptance criteria\n\n- WHEN /cancel arrives, transition within 2s.\n`;

    await runPreflight(
      baseOpts({
        createAgentSession: wrapped,
        designBody,
        specBody,
      }),
    );

    expect(captured).toContain("Cancel runs cleanly");
    expect(captured).toContain("WHEN /cancel arrives");
    expect(captured).not.toContain(designSentinel);
    expect(captured).toContain("Full context (read on demand)");
  });
});
