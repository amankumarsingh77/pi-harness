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
  getModelCatalog: () => real.getModelCatalog(),
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
  listRunFiles: async (runId) => {
    // Soft-fail: an unreachable orchestrator or a run without a worktree
    // means no files-touched data — render the empty state, don't crash
    // the page.
    try {
      return await real.listRunFiles(runId);
    } catch {
      return { files: [] };
    }
  },
  getArtifact: async <T>(taskId: string, name: "brainstorm" | "plan" | "proof-report"): Promise<T> => {
    try {
      return await real.getArtifact<T>(taskId, name);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && name === "brainstorm") {
        return MOCK_BRAINSTORM_ARTIFACT as T;
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
  submitBrainstormAnswers: (taskId, payload) => real.submitBrainstormAnswers(taskId, payload),
  submitBrainstormNudge: (taskId, payload) => real.submitBrainstormNudge(taskId, payload),
  restartBrainstorm: (taskId, payload) => real.restartBrainstorm(taskId, payload),
  getBrainstormDiff: (taskId, kind) => real.getBrainstormDiff(taskId, kind),
  submitArtifactEdit: (taskId, payload) => real.submitArtifactEdit(taskId, payload),
  getBrainstormMocks: (taskId) => real.getBrainstormMocks(taskId),
  getBrainstormMockPageHtml: (taskId, mockId, pageId) =>
    real.getBrainstormMockPageHtml(taskId, mockId, pageId),
  submitBrainstormMockEdit: (taskId, mockId, payload) =>
    real.submitBrainstormMockEdit(taskId, mockId, payload),
  selectBrainstormMock: (taskId, mockId) => real.selectBrainstormMock(taskId, mockId),
  getPlanBundle: (taskId) => real.getPlanBundle(taskId),
  getPlanDiff: (taskId, kind) => real.getPlanDiff(taskId, kind),
  submitPlanArtifactEdit: (taskId, payload) => real.submitPlanArtifactEdit(taskId, payload),
  restartPlan: (taskId, payload) => real.restartPlan(taskId, payload),
};
