import "server-only";
import { api, ApiError, type Api, type BrainstormBundle, type ChatThreadDetail } from "@/lib/api";
import type { ChatThread } from "@pi-harness/shared";
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
 * new-task flow, and task-detail header are fully wired against the orchestrator.
 *
 * Mock fallbacks: brainstorm artifact and run events. These surfaces stay on
 * fixtures until the agent run-loop produces real artifacts. Remove each
 * branch as the corresponding orchestrator endpoint starts emitting real data.
 */
export const orchestrator: Api = {
  listTasks: () => real.listTasks(),
  createTask: (input) => real.createTask(input),
  getProviders: async () => {
    // Soft-fail: an unreachable orchestrator should not crash the new-task or
    // chat pages; the caller renders an empty/error state from an empty list.
    try {
      return await real.getProviders();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 503)) {
        return { providers: [] };
      }
      throw e;
    }
  },
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
  promoteBrainstormMock: (taskId, mockId) => real.promoteBrainstormMock(taskId, mockId),
  confirmPromoteBrainstormMock: (taskId, mockId, diff) =>
    real.confirmPromoteBrainstormMock(taskId, mockId, diff),
  getDesignSystem: () => real.getDesignSystem(),
  getPlanBundle: (taskId) => real.getPlanBundle(taskId),
  getMission: (taskId) => real.getMission(taskId),
  runVerifier: (taskId, payload) => real.runVerifier(taskId, payload),
  getPlanDiff: (taskId, kind) => real.getPlanDiff(taskId, kind),
  submitPlanArtifactEdit: (taskId, payload) => real.submitPlanArtifactEdit(taskId, payload),
  restartPlan: (taskId, payload) => real.restartPlan(taskId, payload),
  createChatThread: (input) => real.createChatThread(input),
  listChatThreads: async (): Promise<{ threads: ChatThread[] }> => {
    try {
      return await real.listChatThreads();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 503)) {
        return { threads: [] };
      }
      throw e;
    }
  },
  getChatThread: (threadId) => real.getChatThread(threadId),
  postChatMessage: (threadId, payload) => real.postChatMessage(threadId, payload),
  updateChatModel: (threadId, model) => real.updateChatModel(threadId, model),
  stopChatTurn: (threadId) => real.stopChatTurn(threadId),
};

/**
 * Server-only helper for the /chat/[threadId] route: returns the thread detail,
 * or `thread: null` when the orchestrator reports it missing/unavailable so the
 * page can call notFound(). Kept separate from the Api-typed `orchestrator`
 * object because the client Api contract always resolves a concrete thread.
 */
export async function getChatThreadOrNull(
  threadId: string,
): Promise<{ thread: ChatThread | null; messages: ChatThreadDetail["messages"] }> {
  try {
    return await real.getChatThread(threadId);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 503)) {
      return { thread: null, messages: [] };
    }
    throw e;
  }
}
