import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Type, type Static, type TSchema } from "typebox";

type ToolResult<T> = {
  content: { type: "text"; text: string }[];
  details: T;
  terminate?: boolean;
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

const WriteFindingsParams = Type.Object({
  body: Type.String({ minLength: 1 }),
});

export type WriteFindingsDetails = { ok: true; path: string };

// Path-locked at construction. The tool surface deliberately exposes no path
// argument — the model can only write the body, never choose where it lands.
// Replaces the unconstrained `write` built-in for research subagents.
//
// The returned object also carries a non-tool-surface `__path` and `__subagent`
// for test introspection — the SDK ignores unknown fields on ToolDefinition.
export function makeWriteFindingsTool(deps: {
  cwd: string;
  taskId: string;
  subagent: string;
}): ToolLike<typeof WriteFindingsParams, WriteFindingsDetails> & {
  __path: string;
  __subagent: string;
} {
  const { cwd, taskId, subagent } = deps;
  const path = join(cwd, ".harness", taskId, "research", `${subagent}.md`);

  return {
    name: "write_findings",
    label: "Write findings",
    description:
      "Persist your findings document. Accepts a single `body` argument (the full markdown). The path is pre-bound to your assigned findings file; repeated calls overwrite the same file so you can checkpoint early and finalize later.",
    parameters: WriteFindingsParams,
    async execute(_id, params) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, params.body, "utf8");
      return {
        content: [{ type: "text", text: `wrote ${path}` }],
        details: { ok: true, path },
      };
    },
    __path: path,
    __subagent: subagent,
  };
}
