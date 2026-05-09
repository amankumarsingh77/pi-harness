import "server-only";
import { api, ApiError, type Api, type BrainstormBundle } from "@/lib/api";
import {
  MOCK_BRAINSTORM_ARTIFACT,
  MOCK_EVENTS,
  MOCK_BRAINSTORM_BUNDLE,
} from "./_fixtures/task-detail";

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "http://localhost:4000";

const real = api({ baseUrl: ORCHESTRATOR_URL });

/**
 * Hybrid orchestrator client.
 *
 * Real backend: listTasks, createTask, getTask, transitionTask. The board (/),
 * new-task flow, and task-detail header are fully wired against Postgres.
 *
 * Mock fallbacks: brainstorm artifact and run events. These surfaces stay on
 * fixtures until the agent run-loop produces real artifacts. Remove each
 * branch as the corresponding orchestrator endpoint starts emitting real data.
 */
export const orchestrator: Api = {
  listTasks: () => real.listTasks(),
  createTask: (input) => real.createTask(input),
  transitionTask: (id, action) => real.transitionTask(id, action),
  getTask: (id) => real.getTask(id),
  listEvents: async (runId) => {
    try {
      return await real.listEvents(runId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        return { events: MOCK_EVENTS };
      }
      throw e;
    }
  },
  getArtifact: async <T>(taskId: string, name: "brainstorm" | "plan" | "proof-report"): Promise<T> => {
    try {
      return await real.getArtifact<T>(taskId, name);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && name === "brainstorm") {
        return MOCK_BRAINSTORM_ARTIFACT as unknown as T;
      }
      throw e;
    }
  },
  getBrainstormBundle: async (taskId: string): Promise<BrainstormBundle> => {
    try {
      return await real.getBrainstormBundle(taskId);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 503)) {
        return MOCK_BRAINSTORM_BUNDLE;
      }
      throw e;
    }
  },
  submitBrainstormAnswer: (taskId, payload) => real.submitBrainstormAnswer(taskId, payload),
};
