"use client";

import { api, type Api } from "@/lib/api";

// All client requests are rewritten to /api/proxy/* so the orchestrator URL
// is never exposed to the browser.
const proxied: Api = api({
  baseUrl: "",
  fetch: (input, init) => fetch(input.replace(/^\/api\//, "/api/proxy/"), init),
});

export const queryKeys = {
  tasks: ["tasks"] as const,
  task: (id: string) => ["tasks", id] as const,
  events: (runId: string) => ["runs", runId, "events"] as const,
  runFiles: (runId: string) => ["runs", runId, "files"] as const,
  brainstormBundle: (taskId: string) => ["tasks", taskId, "brainstorm"] as const,
  planBundle: (taskId: string) => ["tasks", taskId, "plan"] as const,
  mission: (taskId: string) => ["tasks", taskId, "mission"] as const,
  artifact: (taskId: string, name: "brainstorm" | "plan" | "proof-report") =>
    ["tasks", taskId, "artifacts", name] as const,
};

export const queries = {
  listTasks: () => ({
    queryKey: queryKeys.tasks,
    queryFn: () => proxied.listTasks(),
  }),
  getTask: (id: string) => ({
    queryKey: queryKeys.task(id),
    queryFn: () => proxied.getTask(id),
  }),
  listEvents: (runId: string) => ({
    queryKey: queryKeys.events(runId),
    queryFn: () => proxied.listEvents(runId),
  }),
  listRunFiles: (runId: string) => ({
    queryKey: queryKeys.runFiles(runId),
    queryFn: () => proxied.listRunFiles(runId),
  }),
  getBrainstormBundle: (taskId: string) => ({
    queryKey: queryKeys.brainstormBundle(taskId),
    queryFn: () => proxied.getBrainstormBundle(taskId),
  }),
  getPlanBundle: (taskId: string) => ({
    queryKey: queryKeys.planBundle(taskId),
    queryFn: () => proxied.getPlanBundle(taskId),
  }),
  getMission: (taskId: string) => ({
    queryKey: queryKeys.mission(taskId),
    queryFn: () => proxied.getMission(taskId),
  }),
  getArtifact: <T,>(taskId: string, name: "brainstorm" | "plan" | "proof-report") => ({
    queryKey: queryKeys.artifact(taskId, name),
    queryFn: () => proxied.getArtifact<T>(taskId, name),
  }),
};

export const mutations = {
  createTask: () => ({
    mutationFn: (input: Parameters<Api["createTask"]>[0]) =>
      proxied.createTask(input),
  }),
  transitionTask: (id: string) => ({
    mutationFn: (action: Parameters<Api["transitionTask"]>[1]) =>
      proxied.transitionTask(id, action),
  }),
};
