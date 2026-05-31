// Loose, dependency-free parser for the execution-dag artifact body.
//
// The artifact is YAML, but js-yaml is a server-only dependency in this repo —
// pulling it into the dashboard bundle is not worth it for one read-only view.
// This line-based parser reads the two shapes the code page needs: the `nodes:`
// list (with each node's scalars + `dependsOn`) and the optional `waves:` list.
// It is intentionally permissive: unknown keys are ignored, and a malformed
// body degrades to fewer nodes rather than throwing.
//
// `execution-phases-preview.tsx` consumes the same node-grouping logic via
// `groupNodesByPhase`, so there is exactly one parser of this format.

export type NodeSafety = "parallel-safe" | "exclusive";
export type WavePolicy = "parallel" | "sequential";

export type ParsedDagNode = {
  readonly id: string;
  readonly title: string;
  readonly phase: string;
  readonly kind: string;
  readonly lane: string;
  readonly safety: NodeSafety;
  readonly dependsOn: readonly string[];
  readonly assertion: string | null;
};

export type ParsedWave = {
  readonly id: string;
  readonly name: string;
  readonly policy: WavePolicy;
  readonly nodes: readonly string[];
};

export type ParsedDag = {
  readonly nodes: readonly ParsedDagNode[];
  readonly waves: readonly ParsedWave[];
};

export function parseExecutionDag(body: string): ParsedDag {
  const lines = body.split("\n");
  const nodes = parseNodes(lines);
  const waves = parseWaves(lines);
  return { nodes, waves };
}

// ── nodes ──────────────────────────────────────────────────────────────────

type DraftNode = {
  id: string;
  title: string;
  phase: string;
  kind: string;
  lane: string;
  safety: NodeSafety;
  dependsOn: readonly string[];
  assertion: string | null;
};

function parseNodes(lines: readonly string[]): readonly ParsedDagNode[] {
  const drafts: DraftNode[] = [];
  let current: DraftNode | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const id = line.match(/^-\s+id:\s*(C-\d+)/)?.[1];
    if (id) {
      if (current) drafts.push(current);
      current = newDraftNode(id);
      continue;
    }
    if (current) assignNodeScalar(current, line);
  }
  if (current) drafts.push(current);

  return drafts;
}

function newDraftNode(id: string): DraftNode {
  return {
    id,
    title: id,
    phase: "Implementation",
    kind: "task",
    lane: "general",
    safety: "exclusive",
    dependsOn: [],
    assertion: null,
  };
}

function assignNodeScalar(node: DraftNode, line: string): void {
  const parsed = splitKeyValue(line);
  if (!parsed) return;
  const { key, value } = parsed;
  switch (key) {
    case "title":
      node.title = unquote(value);
      return;
    case "phase":
      node.phase = unquote(value);
      return;
    case "kind":
      node.kind = unquote(value);
      return;
    case "lane":
      node.lane = unquote(value);
      return;
    case "assertion":
      node.assertion = unquote(value);
      return;
    case "safety":
      if (value === "parallel-safe" || value === "exclusive") node.safety = value;
      return;
    case "dependsOn":
      node.dependsOn = parseInlineList(value);
      return;
    default:
      return;
  }
}

// ── waves ──────────────────────────────────────────────────────────────────

type DraftWave = {
  id: string;
  name: string;
  policy: WavePolicy;
  nodes: readonly string[];
};

// Parsing is scoped to the region after a top-level `waves:` key so node-level
// `id:`/`name:` lines are never mistaken for wave fields.
function parseWaves(lines: readonly string[]): readonly ParsedWave[] {
  const start = lines.findIndex((line) => /^waves:\s*$/.test(line.trim()));
  if (start === -1) return [];

  const region = lines.slice(start + 1);
  const drafts: DraftWave[] = [];
  let current: DraftWave | null = null;

  for (const rawLine of region) {
    if (isNewTopLevelKey(rawLine)) break;
    const line = rawLine.trim();
    const id = line.match(/^-\s+id:\s*(.+)$/)?.[1];
    if (id) {
      if (current) drafts.push(current);
      current = { id: unquote(id), name: unquote(id), policy: "sequential", nodes: [] };
      continue;
    }
    if (current) assignWaveScalar(current, line);
  }
  if (current) drafts.push(current);

  return drafts.filter((wave) => wave.nodes.length > 0);
}

function assignWaveScalar(wave: DraftWave, line: string): void {
  const inlineNode = line.match(/^-\s+(C-\d+)$/)?.[1];
  if (inlineNode) {
    wave.nodes = [...wave.nodes, inlineNode];
    return;
  }
  const parsed = splitKeyValue(line);
  if (!parsed) return;
  const { key, value } = parsed;
  if (key === "name") wave.name = unquote(value);
  else if (key === "policy" && (value === "parallel" || value === "sequential")) wave.policy = value;
  else if (key === "nodes" && value.startsWith("[")) wave.nodes = parseInlineList(value);
}

// A line that begins a new unindented `key:` (no leading whitespace, no `-`)
// marks the end of the `waves:` block.
function isNewTopLevelKey(rawLine: string): boolean {
  return /^[A-Za-z]/.test(rawLine) && /^[A-Za-z][\w-]*:\s*$/.test(rawLine.trim());
}

// ── shared helpers ───────────────────────────────────────────────────────────

function splitKeyValue(line: string): { key: string; value: string } | null {
  const withoutBullet = line.replace(/^-\s+/, "");
  const colon = withoutBullet.indexOf(":");
  if (colon === -1) return null;
  const key = withoutBullet.slice(0, colon).trim();
  const value = withoutBullet.slice(colon + 1).trim();
  if (key.length === 0) return null;
  return { key, value };
}

function parseInlineList(value: string): readonly string[] {
  if (!value.startsWith("[") || !value.endsWith("]")) return [];
  const inner = value.slice(1, -1).trim();
  if (inner.length === 0) return [];
  return inner
    .split(",")
    .map((part) => unquote(part.trim()))
    .filter((part) => part.length > 0);
}

function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

// ── phase grouping (shared with execution-phases-preview) ────────────────────

export type PhaseGroup = {
  readonly name: string;
  readonly nodes: readonly ParsedDagNode[];
  readonly policy: WavePolicy;
};

// Fallback wave inference for DAGs authored without an explicit `waves:` block:
// group nodes by their `phase` field, preserving first-seen order, and infer the
// policy (parallel only when every node in the group is parallel-safe).
export function groupNodesByPhase(nodes: readonly ParsedDagNode[]): readonly PhaseGroup[] {
  const order: string[] = [];
  const byPhase = new Map<string, ParsedDagNode[]>();
  for (const node of nodes) {
    const existing = byPhase.get(node.phase);
    if (existing) {
      existing.push(node);
    } else {
      byPhase.set(node.phase, [node]);
      order.push(node.phase);
    }
  }
  return order.map((name) => {
    const phaseNodes = byPhase.get(name) ?? [];
    const policy: WavePolicy =
      phaseNodes.length > 1 && phaseNodes.every((node) => node.safety === "parallel-safe")
        ? "parallel"
        : "sequential";
    return { name, nodes: phaseNodes, policy };
  });
}
