import { z } from "zod";
import { BlastRadiusRefSchema, RequirementRefSchema } from "./blast-radius.js";

export const ExecutionDagNodeIdSchema = z.string().regex(/^C-\d+$/);

export const ExecutionDagNodeSchema = z.object({
  id: ExecutionDagNodeIdSchema,
  title: z.string().min(1),
  phase: z.string().min(1),
  kind: z.string().min(1),
  lane: z.string().min(1),
  safety: z.enum(["parallel-safe", "exclusive"]),
  dependsOn: z.array(ExecutionDagNodeIdSchema),
  writes: z.array(z.string().min(1)).min(1),
  reads: z.array(z.string().min(1)),
  verifies: z.array(z.string().min(1)).min(1),
  covers: z.array(RequirementRefSchema).min(1),
  blastRadius: z.array(BlastRadiusRefSchema).min(1),
  assertion: z.string().min(1),
});

export const ExecutionDagWaveSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  policy: z.enum(["parallel", "sequential"]),
  nodes: z.array(ExecutionDagNodeIdSchema).min(1),
});

export const ExecutionDagSchema = z
  .object({
    version: z.literal(1),
    nodes: z.array(ExecutionDagNodeSchema).min(1),
    waves: z.array(ExecutionDagWaveSchema).optional(),
  })
  .superRefine((dag, ctx) => {
    const nodeIds = new Set<string>();
    for (const node of dag.nodes) {
      if (nodeIds.has(node.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate node id: ${node.id}`,
          path: ["nodes"],
        });
      }
      nodeIds.add(node.id);
    }

    for (const node of dag.nodes) {
      for (const dep of node.dependsOn) {
        if (!nodeIds.has(dep)) {
          ctx.addIssue({
            code: "custom",
            message: `unknown dependency ${dep} on ${node.id}`,
            path: ["nodes", node.id, "dependsOn"],
          });
        }
      }
    }

    for (const wave of dag.waves ?? []) {
      for (const nodeId of wave.nodes) {
        if (!nodeIds.has(nodeId)) {
          ctx.addIssue({
            code: "custom",
            message: `unknown wave node ${nodeId} on ${wave.id}`,
            path: ["waves", wave.id, "nodes"],
          });
        }
      }
    }

    const cycle = findCycle(dag.nodes);
    if (cycle) {
      ctx.addIssue({
        code: "custom",
        message: `dependency cycle: ${cycle.join(" -> ")}`,
        path: ["nodes"],
      });
    }
  });

function findCycle(nodes: ReadonlyArray<z.infer<typeof ExecutionDagNodeSchema>>): string[] | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(nodeId: string, path: ReadonlyArray<string>): string[] | null {
    if (visiting.has(nodeId)) {
      const start = path.indexOf(nodeId);
      return [...path.slice(start), nodeId];
    }
    if (visited.has(nodeId)) return null;

    const node = byId.get(nodeId);
    if (!node) return null;

    visiting.add(nodeId);
    for (const dep of node.dependsOn) {
      const cycle = visit(dep, [...path, dep]);
      if (cycle) return cycle;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return null;
  }

  for (const node of nodes) {
    const cycle = visit(node.id, [node.id]);
    if (cycle) return cycle;
  }
  return null;
}
