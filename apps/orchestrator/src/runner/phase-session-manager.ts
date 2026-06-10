import { existsSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentSession, AgentSessionOptions } from "@pi-harness/pi-bridge";
import type { Phase } from "@pi-harness/shared";

export type ManagedSessionScope =
  | { readonly kind: "main" }
  | { readonly kind: "brainstorm-research"; readonly subagent: string }
  | { readonly kind: "code-node"; readonly nodeId: string }
  | { readonly kind: "plan-child"; readonly nodeId: string }
  | { readonly kind: "claim-verifier" };

export type ManagedSessionResetEvent = {
  readonly phase: Phase;
  readonly scope: ManagedSessionScope;
  readonly path: string;
  readonly reason: string;
};

export type ManagedSessionFactory = {
  readonly phase: Phase;
  readonly mainPath: string;
  readonly pathFor: (scope: ManagedSessionScope) => string;
  readonly open: (
    scope: ManagedSessionScope,
    opts: AgentSessionOptionsWithoutSessionPath,
  ) => Promise<AgentSession>;
};

export type AgentSessionOptionsWithoutSessionPath = Omit<AgentSessionOptions, "sessionPath">;

export type PhaseSessionPathInput = {
  readonly cwd: string;
  readonly taskId: string;
  readonly phase: Phase;
  readonly scope: ManagedSessionScope;
};

export type CreatePhaseSessionFactoryInput = {
  readonly cwd: string;
  readonly taskId: string;
  readonly phase: Phase;
  readonly createAgentSession: (opts: AgentSessionOptions) => Promise<AgentSession>;
  readonly onSessionReset?: (event: ManagedSessionResetEvent) => Promise<void> | void;
};

export function phaseSessionPath(input: PhaseSessionPathInput): string {
  const root = join(input.cwd, ".harness", input.taskId);
  if (input.scope.kind === "brainstorm-research") {
    return join(root, "brainstorm-sessions", `${sanitizePathSegment(input.scope.subagent)}.jsonl`);
  }
  if (input.scope.kind === "code-node") {
    return join(root, "code-sessions", `${sanitizePathSegment(input.scope.nodeId)}.jsonl`);
  }
  if (input.scope.kind === "plan-child") {
    return join(root, "plan-sessions", `${sanitizePathSegment(input.scope.nodeId)}.jsonl`);
  }
  if (input.scope.kind === "claim-verifier") {
    return join(root, "plan-sessions", "claim-verifier.jsonl");
  }
  return join(root, mainSessionFileName(input.phase));
}

export function createPhaseSessionFactory(
  input: CreatePhaseSessionFactoryInput,
): ManagedSessionFactory {
  const pathFor = (scope: ManagedSessionScope): string =>
    phaseSessionPath({
      cwd: input.cwd,
      taskId: input.taskId,
      phase: input.phase,
      scope,
    });

  return {
    phase: input.phase,
    mainPath: pathFor({ kind: "main" }),
    pathFor,
    open: (scope, opts) => openManagedSession({
      phase: input.phase,
      scope,
      path: pathFor(scope),
      opts,
      createAgentSession: input.createAgentSession,
      ...(input.onSessionReset !== undefined ? { onSessionReset: input.onSessionReset } : {}),
    }),
  };
}

async function openManagedSession(input: {
  readonly phase: Phase;
  readonly scope: ManagedSessionScope;
  readonly path: string;
  readonly opts: AgentSessionOptionsWithoutSessionPath;
  readonly createAgentSession: (opts: AgentSessionOptions) => Promise<AgentSession>;
  readonly onSessionReset?: (event: ManagedSessionResetEvent) => Promise<void> | void;
}): Promise<AgentSession> {
  await mkdir(dirname(input.path), { recursive: true });
  try {
    return await input.createAgentSession({ ...input.opts, sessionPath: input.path });
  } catch (err) {
    if (!existsSync(input.path)) throw err;
    await unlink(input.path);
    await input.onSessionReset?.({
      phase: input.phase,
      scope: input.scope,
      path: input.path,
      reason: err instanceof Error ? err.message : String(err),
    });
    return input.createAgentSession(input.opts);
  }
}

function mainSessionFileName(phase: Phase): string {
  if (phase === "brainstorm") return "pi-session.jsonl";
  return `pi-session-${phase}.jsonl`;
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "session";
}
