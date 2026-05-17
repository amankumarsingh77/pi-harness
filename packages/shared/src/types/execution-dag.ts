import type { z } from "zod";
import type {
  ExecutionDagNodeSchema,
  ExecutionDagSchema,
  ExecutionDagWaveSchema,
} from "../schemas/execution-dag.js";

export type ExecutionDagNode = z.infer<typeof ExecutionDagNodeSchema>;
export type ExecutionDagWave = z.infer<typeof ExecutionDagWaveSchema>;
export type ExecutionDag = z.infer<typeof ExecutionDagSchema>;
