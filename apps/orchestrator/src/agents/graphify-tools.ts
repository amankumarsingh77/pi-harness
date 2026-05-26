import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Type, type Static, type TSchema } from "typebox";
import {
  type GraphifyLifecycle,
  type GraphifyRunResult,
  graphPathFor,
  legacyGraphPathFor,
} from "./graphify-manager.js";

const MAX_OUTPUT_CHARS = 8_000;
const DEFAULT_MAX_RESULTS = 8;
const MAX_RESULTS = 25;
const DEFAULT_MAX_NEIGHBORS = 12;
const MAX_NEIGHBORS = 40;
const DEFAULT_MAX_HOPS = 6;
const MAX_HOPS = 12;

export const GRAPHIFY_QUERY_TOOL_NAMES = [
  "graphify_query",
  "graphify_path",
  "graphify_explain",
  "graphify_stats",
] as const;

export const GRAPHIFY_REFRESH_TOOL_NAME = "graphify_refresh";

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

type GraphNode = {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly source: string;
  readonly text: string;
};

type GraphEdge = {
  readonly source: string;
  readonly target: string;
  readonly label: string;
  readonly text: string;
};

type GraphData = {
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly edges: ReadonlyArray<GraphEdge>;
};

type GraphToolFailure = {
  readonly ok: false;
  readonly error: string;
  readonly graphPath: string;
};

type GraphQueryDetails =
  | {
      readonly ok: true;
      readonly graphPath: string;
      readonly query: string;
      readonly matches: ReadonlyArray<GraphNode>;
      readonly truncated: boolean;
    }
  | GraphToolFailure;

type GraphPathDetails =
  | {
      readonly ok: true;
      readonly graphPath: string;
      readonly source: string;
      readonly target: string;
      readonly path: ReadonlyArray<GraphNode>;
      readonly truncated: boolean;
    }
  | GraphToolFailure;

type GraphExplainDetails =
  | {
      readonly ok: true;
      readonly graphPath: string;
      readonly node: GraphNode;
      readonly neighbors: ReadonlyArray<GraphNode>;
      readonly edges: ReadonlyArray<GraphEdge>;
      readonly truncated: boolean;
    }
  | GraphToolFailure;

type GraphStatsDetails =
  | {
      readonly ok: true;
      readonly graphPath: string;
      readonly nodeCount: number;
      readonly edgeCount: number;
    }
  | GraphToolFailure;

type GraphRefreshDetails =
  | { readonly ok: true; readonly result: GraphifyRunResult }
  | { readonly ok: false; readonly error: string };

const QueryParams = Type.Object({
  query: Type.String({ minLength: 1 }),
  maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: MAX_RESULTS })),
});

const PathParams = Type.Object({
  source: Type.String({ minLength: 1 }),
  target: Type.String({ minLength: 1 }),
  maxHops: Type.Optional(Type.Number({ minimum: 1, maximum: MAX_HOPS })),
});

const ExplainParams = Type.Object({
  node: Type.String({ minLength: 1 }),
  maxNeighbors: Type.Optional(Type.Number({ minimum: 1, maximum: MAX_NEIGHBORS })),
});

const StatsParams = Type.Object({});
const RefreshParams = Type.Object({});

export function makeGraphifyQueryTools(deps: {
  readonly cwd: string;
  readonly stateDir?: string;
}): ReadonlyArray<
  | ToolLike<typeof QueryParams, GraphQueryDetails>
  | ToolLike<typeof PathParams, GraphPathDetails>
  | ToolLike<typeof ExplainParams, GraphExplainDetails>
  | ToolLike<typeof StatsParams, GraphStatsDetails>
> {
  return [
    makeGraphifyQueryTool(deps),
    makeGraphifyPathTool(deps),
    makeGraphifyExplainTool(deps),
    makeGraphifyStatsTool(deps),
  ];
}

export function makeGraphifyRefreshTool(deps: {
  readonly cwd: string;
  readonly graphify?: GraphifyLifecycle;
}): ToolLike<typeof RefreshParams, GraphRefreshDetails> {
  return {
    name: GRAPHIFY_REFRESH_TOOL_NAME,
    label: "Refresh Graphify graph",
    description:
      "Refresh the current worktree's Graphify graph after code changes. The orchestrator also refreshes automatically after commits.",
    parameters: RefreshParams,
    async execute() {
      if (!deps.graphify) {
        const error = "Graphify refresh is unavailable in this session.";
        return {
          content: [{ type: "text", text: error }],
          details: { ok: false, error },
        };
      }
      const result = await deps.graphify.update(deps.cwd, "agent_refresh");
      const text = result.ok
        ? `Graphify graph refreshed: ${result.status.nodeCount ?? 0} nodes, ${result.status.edgeCount ?? 0} edges.`
        : `Graphify refresh failed: ${result.message}`;
      return {
        content: [{ type: "text", text }],
        details: result.ok ? { ok: true, result } : { ok: false, error: result.message },
      };
    },
  };
}

function makeGraphifyQueryTool(deps: {
  readonly cwd: string;
  readonly stateDir?: string;
}): ToolLike<typeof QueryParams, GraphQueryDetails> {
  return {
    name: "graphify_query",
    label: "Query Graphify graph",
    description:
      "Search the Graphify knowledge graph before broad grep/find/read operations. Returns concise matching nodes with source hints.",
    parameters: QueryParams,
    async execute(_id, params) {
      const loaded = await loadGraph(deps.cwd, deps.stateDir);
      if (!loaded.ok) return graphFailure(loaded.error, loaded.graphPath);
      const limit = bounded(params.maxResults, DEFAULT_MAX_RESULTS, MAX_RESULTS);
      const matches = scoreNodes(loaded.graph.nodes, params.query).slice(0, limit);
      const text = boundText(formatQueryMatches(params.query, matches));
      return {
        content: [{ type: "text", text: text.text }],
        details: {
          ok: true,
          graphPath: loaded.graphPath,
          query: params.query,
          matches,
          truncated: text.truncated,
        },
      };
    },
  };
}

function makeGraphifyPathTool(deps: {
  readonly cwd: string;
  readonly stateDir?: string;
}): ToolLike<typeof PathParams, GraphPathDetails> {
  return {
    name: "graphify_path",
    label: "Find Graphify path",
    description:
      "Find a short path between two graph nodes by id, label, or source text.",
    parameters: PathParams,
    async execute(_id, params) {
      const loaded = await loadGraph(deps.cwd, deps.stateDir);
      if (!loaded.ok) return graphFailure(loaded.error, loaded.graphPath);
      const source = findNode(loaded.graph.nodes, params.source);
      const target = findNode(loaded.graph.nodes, params.target);
      if (!source || !target) {
        return graphFailure("source or target node was not found", loaded.graphPath);
      }
      const path = shortestPath({
        graph: loaded.graph,
        sourceId: source.id,
        targetId: target.id,
        maxHops: bounded(params.maxHops, DEFAULT_MAX_HOPS, MAX_HOPS),
      });
      const text = boundText(formatPath(path));
      return {
        content: [{ type: "text", text: text.text }],
        details: {
          ok: true,
          graphPath: loaded.graphPath,
          source: params.source,
          target: params.target,
          path,
          truncated: text.truncated,
        },
      };
    },
  };
}

function makeGraphifyExplainTool(deps: {
  readonly cwd: string;
  readonly stateDir?: string;
}): ToolLike<typeof ExplainParams, GraphExplainDetails> {
  return {
    name: "graphify_explain",
    label: "Explain Graphify node",
    description:
      "Show one graph node plus its immediate neighbors, useful for understanding local architecture context.",
    parameters: ExplainParams,
    async execute(_id, params) {
      const loaded = await loadGraph(deps.cwd, deps.stateDir);
      if (!loaded.ok) return graphFailure(loaded.error, loaded.graphPath);
      const node = findNode(loaded.graph.nodes, params.node);
      if (!node) return graphFailure("node was not found", loaded.graphPath);
      const limit = bounded(params.maxNeighbors, DEFAULT_MAX_NEIGHBORS, MAX_NEIGHBORS);
      const incident = loaded.graph.edges
        .filter((edge) => edge.source === node.id || edge.target === node.id)
        .slice(0, limit);
      const neighborIds = new Set(
        incident.flatMap((edge) => [edge.source, edge.target]).filter((id) => id !== node.id),
      );
      const neighbors = loaded.graph.nodes.filter((candidate) => neighborIds.has(candidate.id));
      const text = boundText(formatExplanation(node, neighbors, incident));
      return {
        content: [{ type: "text", text: text.text }],
        details: {
          ok: true,
          graphPath: loaded.graphPath,
          node,
          neighbors,
          edges: incident,
          truncated: text.truncated,
        },
      };
    },
  };
}

function makeGraphifyStatsTool(deps: {
  readonly cwd: string;
  readonly stateDir?: string;
}): ToolLike<typeof StatsParams, GraphStatsDetails> {
  return {
    name: "graphify_stats",
    label: "Graphify stats",
    description: "Report whether the Graphify graph is available and how large it is.",
    parameters: StatsParams,
    async execute() {
      const loaded = await loadGraph(deps.cwd, deps.stateDir);
      if (!loaded.ok) return graphFailure(loaded.error, loaded.graphPath);
      const text = `${loaded.graph.nodes.length} nodes, ${loaded.graph.edges.length} edges in ${loaded.graphPath}`;
      return {
        content: [{ type: "text", text }],
        details: {
          ok: true,
          graphPath: loaded.graphPath,
          nodeCount: loaded.graph.nodes.length,
          edgeCount: loaded.graph.edges.length,
        },
      };
    },
  };
}

async function loadGraph(cwd: string, stateDir?: string): Promise<
  | { readonly ok: true; readonly graphPath: string; readonly graph: GraphData }
  | { readonly ok: false; readonly graphPath: string; readonly error: string }
> {
  const graphPath = graphPathFor(cwd, stateDir);
  const legacyGraphPath = legacyGraphPathFor(cwd);
  const readableGraphPath = existsSync(graphPath) ? graphPath : legacyGraphPath;
  if (!existsSync(readableGraphPath)) {
    return { ok: false, graphPath, error: "graphify-out/graph.json does not exist" };
  }
  try {
    const parsed: unknown = JSON.parse(await readFile(readableGraphPath, "utf8"));
    if (!isRecord(parsed)) return { ok: false, graphPath, error: "graph.json root is not an object" };
    const nodes = normalizeNodes(parsed["nodes"]);
    if (nodes.length === 0) return { ok: false, graphPath, error: "graph.json has no nodes" };
    return {
      ok: true,
      graphPath: readableGraphPath,
      graph: {
        nodes,
        edges: normalizeEdges(parsed["edges"]),
      },
    };
  } catch (err) {
    return { ok: false, graphPath, error: (err as Error).message };
  }
}

function normalizeNodes(value: unknown): ReadonlyArray<GraphNode> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => normalizeNode(item, String(index)));
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([id, item]) => normalizeNode(item, id));
  }
  return [];
}

function normalizeNode(value: unknown, fallbackId: string): ReadonlyArray<GraphNode> {
  if (!isRecord(value)) return [];
  const id = stringField(value, ["id", "key", "node_id"]) ?? fallbackId;
  const label = stringField(value, ["label", "name", "title", "qualified_name"]) ?? id;
  const kind = stringField(value, ["kind", "type", "category"]) ?? "node";
  const source = stringField(value, ["source", "path", "file", "file_path"]) ?? "";
  return [{
    id,
    label,
    kind,
    source,
    text: JSON.stringify(value),
  }];
}

function normalizeEdges(value: unknown): ReadonlyArray<GraphEdge> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeEdge(item));
  }
  if (isRecord(value)) {
    return Object.values(value).flatMap((item) => normalizeEdge(item));
  }
  return [];
}

function normalizeEdge(value: unknown): ReadonlyArray<GraphEdge> {
  if (!isRecord(value)) return [];
  const source = stringField(value, ["source", "from", "src"]) ?? "";
  const target = stringField(value, ["target", "to", "dst"]) ?? "";
  if (!source || !target) return [];
  const label = stringField(value, ["label", "type", "kind", "relation"]) ?? "related";
  return [{ source, target, label, text: JSON.stringify(value) }];
}

function scoreNodes(nodes: ReadonlyArray<GraphNode>, query: string): ReadonlyArray<GraphNode> {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 0);
  return nodes
    .map((node) => ({ node, score: scoreText(node.text.toLowerCase(), terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.node);
}

function scoreText(text: string, terms: ReadonlyArray<string>): number {
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

function findNode(nodes: ReadonlyArray<GraphNode>, query: string): GraphNode | null {
  const needle = query.toLowerCase();
  return nodes.find((node) =>
    node.id.toLowerCase() === needle ||
    node.label.toLowerCase() === needle ||
    node.source.toLowerCase() === needle ||
    node.text.toLowerCase().includes(needle)
  ) ?? null;
}

function shortestPath(args: {
  readonly graph: GraphData;
  readonly sourceId: string;
  readonly targetId: string;
  readonly maxHops: number;
}): ReadonlyArray<GraphNode> {
  const byId = new Map(args.graph.nodes.map((node) => [node.id, node]));
  const adjacency = buildAdjacency(args.graph.edges);
  const queue: string[][] = [[args.sourceId]];
  const seen = new Set([args.sourceId]);
  let cursor = 0;
  while (cursor < queue.length) {
    const path = queue[cursor] ?? [];
    cursor += 1;
    const last = path[path.length - 1];
    if (!last) continue;
    if (last === args.targetId) {
      return path.flatMap((id) => byId.get(id) ?? []);
    }
    if (path.length > args.maxHops) continue;
    for (const next of adjacency.get(last) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return [];
}

function buildAdjacency(edges: ReadonlyArray<GraphEdge>): Map<string, ReadonlyArray<string>> {
  const out = new Map<string, string[]>();
  for (const edge of edges) {
    out.set(edge.source, [...(out.get(edge.source) ?? []), edge.target]);
    out.set(edge.target, [...(out.get(edge.target) ?? []), edge.source]);
  }
  return out;
}

function formatQueryMatches(query: string, matches: ReadonlyArray<GraphNode>): string {
  if (matches.length === 0) return `No Graphify matches for "${query}".`;
  return [
    `Graphify matches for "${query}":`,
    ...matches.map((node) => `- ${node.id} [${node.kind}] ${node.label}${node.source ? ` (${node.source})` : ""}`),
  ].join("\n");
}

function formatPath(path: ReadonlyArray<GraphNode>): string {
  if (path.length === 0) return "No Graphify path found.";
  return path.map((node) => `${node.label} (${node.id})`).join(" -> ");
}

function formatExplanation(
  node: GraphNode,
  neighbors: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
): string {
  return [
    `${node.id} [${node.kind}] ${node.label}${node.source ? ` (${node.source})` : ""}`,
    "",
    "Neighbors:",
    ...(neighbors.length === 0
      ? ["- none"]
      : neighbors.map((neighbor) => `- ${neighbor.id} [${neighbor.kind}] ${neighbor.label}`)),
    "",
    "Edges:",
    ...(edges.length === 0
      ? ["- none"]
      : edges.map((edge) => `- ${edge.source} -${edge.label}-> ${edge.target}`)),
  ].join("\n");
}

function stringField(record: Record<string, unknown>, keys: ReadonlyArray<string>): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function bounded(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

function boundText(text: string): { readonly text: string; readonly truncated: boolean } {
  if (text.length <= MAX_OUTPUT_CHARS) return { text, truncated: false };
  return { text: `${text.slice(0, MAX_OUTPUT_CHARS)}\n[truncated]\n`, truncated: true };
}

function graphFailure(
  error: string,
  graphPath: string,
): ToolResult<GraphToolFailure> {
  return {
    content: [{ type: "text", text: error }],
    details: { ok: false, error, graphPath },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
