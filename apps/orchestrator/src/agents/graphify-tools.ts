import { Type, type Static, type TSchema } from "typebox";
import type { GraphifyCliResult, GraphifyService } from "../services/graphify-service.js";

type ToolResult<T> = {
  content: { type: "text"; text: string }[];
  readonly details: T;
};

type ToolLike<TParams extends TSchema, TDetails> = {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: TParams;
  readonly execute: (
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: never,
  ) => Promise<ToolResult<TDetails>>;
};

export type GraphifyToolDetails =
  | {
      readonly ok: true;
      readonly command: string;
      readonly args: readonly string[];
      readonly output: string;
      readonly truncated: false;
    }
  | {
      readonly ok: false;
      readonly command: string;
      readonly args: readonly string[];
      readonly output: string;
      readonly error: string;
      readonly truncated: false;
    };

const QueryParams = Type.Object({
  question: Type.String({ minLength: 1 }),
  traversal: Type.Optional(Type.Union([Type.Literal("bfs"), Type.Literal("dfs")])),
  budget: Type.Optional(Type.Number({ minimum: 200, maximum: 8000 })),
});

const PathParams = Type.Object({
  from: Type.String({ minLength: 1 }),
  to: Type.String({ minLength: 1 }),
});

const ExplainParams = Type.Object({
  node: Type.String({ minLength: 1 }),
});

const AffectedParams = Type.Object({
  path: Type.String({ minLength: 1 }),
});

export function makeGraphifyTools(deps: {
  readonly graphify: GraphifyService;
  readonly defaultBudget: number;
}): readonly ToolLike<TSchema, GraphifyToolDetails>[] {
  return [
    makeGraphifyQueryTool(deps),
    makeGraphifyPathTool(deps),
    makeGraphifyExplainTool(deps),
    makeGraphifyAffectedTool(deps),
  ];
}

function makeGraphifyQueryTool(deps: {
  readonly graphify: GraphifyService;
  readonly defaultBudget: number;
}): ToolLike<typeof QueryParams, GraphifyToolDetails> {
  return {
    name: "graphify_query",
    label: "Graphify query",
    description:
      "Query the repository knowledge graph for broad or focused architecture context. Read-only.",
    parameters: QueryParams,
    execute: async (_id, params, signal) => {
      const budget = params.budget ?? deps.defaultBudget;
      const args = [
        "query",
        params.question,
        "--budget",
        String(budget),
        ...(params.traversal === "dfs" ? ["--dfs"] : []),
      ];
      return toolResult(await deps.graphify.runQuery(args, signal));
    },
  };
}

function makeGraphifyPathTool(deps: {
  readonly graphify: GraphifyService;
}): ToolLike<typeof PathParams, GraphifyToolDetails> {
  return {
    name: "graphify_path",
    label: "Graphify path",
    description:
      "Find the shortest graph path between two repository concepts, modules, files, or symbols. Read-only.",
    parameters: PathParams,
    execute: async (_id, params, signal) =>
      toolResult(await deps.graphify.runQuery(["path", params.from, params.to], signal)),
  };
}

function makeGraphifyExplainTool(deps: {
  readonly graphify: GraphifyService;
}): ToolLike<typeof ExplainParams, GraphifyToolDetails> {
  return {
    name: "graphify_explain",
    label: "Graphify explain",
    description:
      "Explain one repository graph node using Graphify's persisted graph context. Read-only.",
    parameters: ExplainParams,
    execute: async (_id, params, signal) =>
      toolResult(await deps.graphify.runQuery(["explain", params.node], signal)),
  };
}

function makeGraphifyAffectedTool(deps: {
  readonly graphify: GraphifyService;
}): ToolLike<typeof AffectedParams, GraphifyToolDetails> {
  return {
    name: "graphify_affected",
    label: "Graphify affected",
    description:
      "List graph nodes and communities likely affected by a changed file or path. Read-only.",
    parameters: AffectedParams,
    execute: async (_id, params, signal) =>
      toolResult(await deps.graphify.runQuery(["affected", params.path], signal)),
  };
}

function toolResult(result: GraphifyCliResult): ToolResult<GraphifyToolDetails> {
  const output = result.stdout || result.stderr;
  if (result.ok) {
    return {
      content: [{ type: "text", text: output }],
      details: {
        ok: true,
        command: result.command,
        args: result.args,
        output,
        truncated: false,
      },
    };
  }
  return {
    content: [{ type: "text", text: output }],
    details: {
      ok: false,
      command: result.command,
      args: result.args,
      output: "",
      error: output,
      truncated: false,
    },
  };
}
