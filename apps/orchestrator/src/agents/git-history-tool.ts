import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type, type Static, type TSchema } from "typebox";

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_CHARS = 12_000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

type ToolResult<T> = {
  content: { type: "text"; text: string }[];
  details: T;
};

type ToolLike<TParams extends TSchema, TDetails> = {
  name: string;
  label: string;
  description: string;
  parameters: TParams;
  execute: (
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: never,
  ) => Promise<ToolResult<TDetails>>;
};

const GitHistoryParams = Type.Object({
  action: Type.Union([
    Type.Literal("is_repo"),
    Type.Literal("log_by_path"),
    Type.Literal("log_by_grep"),
    Type.Literal("show_stat"),
    Type.Literal("show_file_at_commit"),
  ]),
  path: Type.Optional(Type.String({ minLength: 1 })),
  query: Type.Optional(Type.String({ minLength: 1 })),
  commit: Type.Optional(Type.String({ minLength: 1 })),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: MAX_LIMIT })),
});

export type GitHistoryDetails =
  | {
      ok: true;
      action: Static<typeof GitHistoryParams>["action"];
      output: string;
      truncated: boolean;
    }
  | {
      ok: false;
      action: Static<typeof GitHistoryParams>["action"];
      output: "";
      error: string;
      truncated: false;
    };

export function makeGitHistoryTool(deps: {
  cwd: string;
  maxCalls?: number;
}): ToolLike<typeof GitHistoryParams, GitHistoryDetails> {
  let calls = 0;
  return {
    name: "git_history",
    label: "Git history",
    description:
      "Read-only git history helper. Supports is_repo, log_by_path, log_by_grep, show_stat, and show_file_at_commit. It never mutates the repository.",
    parameters: GitHistoryParams,
    async execute(_id, params, signal) {
      calls += 1;
      if (deps.maxCalls !== undefined && calls > deps.maxCalls) {
        return failure(params.action, `git_history call budget exceeded (${deps.maxCalls})`);
      }
      const validationError = validateParams(params);
      if (validationError) return failure(params.action, validationError);

      const limit = boundedLimit(params.limit);
      const args = buildGitArgs(params, limit);
      if (!args.ok) return failure(params.action, args.error);

      const result = await runGit({
        cwd: deps.cwd,
        args: args.args,
        ...(signal !== undefined ? { signal } : {}),
      });
      if (!result.ok) return failure(params.action, result.error);

      const bounded = boundOutput(result.output);
      return {
        content: [{ type: "text", text: bounded.output }],
        details: {
          ok: true,
          action: params.action,
          output: bounded.output,
          truncated: bounded.truncated,
        },
      };
    },
  };
}

function validateParams(params: Static<typeof GitHistoryParams>): string | null {
  if (params.action === "log_by_path" && !params.path) {
    return "log_by_path requires path";
  }
  if (params.action === "log_by_grep" && !params.query) {
    return "log_by_grep requires query";
  }
  if (params.action === "show_stat" && !params.commit) {
    return "show_stat requires commit";
  }
  if (params.action === "show_file_at_commit") {
    if (!params.commit) return "show_file_at_commit requires commit";
    if (!params.path) return "show_file_at_commit requires path";
  }
  if (params.path && !isSafePath(params.path)) {
    return "path must be relative and must not start with '-' or contain NUL";
  }
  if (params.commit && !isSafeCommit(params.commit)) {
    return "commit must not contain ':' or NUL";
  }
  return null;
}

function buildGitArgs(
  params: Static<typeof GitHistoryParams>,
  limit: number,
): { ok: true; args: string[] } | { ok: false; error: string } {
  if (params.action === "is_repo") {
    return { ok: true, args: ["rev-parse", "--is-inside-work-tree"] };
  }
  if (params.action === "log_by_path") {
    return {
      ok: true,
      args: [
        "log",
        `--max-count=${limit}`,
        "--date=short",
        "--format=%H %ad %s",
        "--",
        params.path!,
      ],
    };
  }
  if (params.action === "log_by_grep") {
    return {
      ok: true,
      args: [
        "log",
        `--max-count=${limit}`,
        "--date=short",
        "--format=%H %ad %s",
        `--grep=${params.query!}`,
      ],
    };
  }
  if (params.action === "show_stat") {
    return {
      ok: true,
      args: ["show", "--stat", "--oneline", "--no-renames", params.commit!],
    };
  }
  if (params.action === "show_file_at_commit") {
    return {
      ok: true,
      args: ["show", `${params.commit!}:${params.path!}`],
    };
  }
  return { ok: false, error: `unknown action: ${String(params.action)}` };
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
}

function isSafePath(path: string): boolean {
  return !path.startsWith("/") && !path.startsWith("-") && !path.includes("\0");
}

function isSafeCommit(commit: string): boolean {
  return !commit.includes(":") && !commit.includes("\0");
}

async function runGit(args: {
  cwd: string;
  args: string[];
  signal?: AbortSignal;
}): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args.args, {
      cwd: args.cwd,
      maxBuffer: 1_000_000,
      ...(args.signal !== undefined ? { signal: args.signal } : {}),
    });
    return { ok: true, output: stdout.length > 0 ? stdout : stderr };
  } catch (err) {
    const maybe = err as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const stderr = typeof maybe.stderr === "string" ? maybe.stderr.trim() : "";
    const stdout = typeof maybe.stdout === "string" ? maybe.stdout.trim() : "";
    const message = typeof maybe.message === "string" ? maybe.message : String(err);
    return { ok: false, error: stderr || stdout || message };
  }
}

function boundOutput(output: string): { output: string; truncated: boolean } {
  if (output.length <= MAX_OUTPUT_CHARS) return { output, truncated: false };
  return {
    output: `${output.slice(0, MAX_OUTPUT_CHARS)}\n[truncated]\n`,
    truncated: true,
  };
}

function failure(
  action: Static<typeof GitHistoryParams>["action"],
  error: string,
): ToolResult<GitHistoryDetails> {
  return {
    content: [{ type: "text", text: error }],
    details: { ok: false, action, output: "", error, truncated: false },
  };
}
