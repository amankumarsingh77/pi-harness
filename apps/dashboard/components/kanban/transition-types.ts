import type { Api } from "@/lib/api";

export type BoardTransitionAction = Parameters<Api["transitionTask"]>[1];
export type BoardTransition = (
  taskId: string,
  action: BoardTransitionAction,
) => Promise<void>;
