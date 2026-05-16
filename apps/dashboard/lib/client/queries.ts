"use client";

import { api, type Api } from "@/lib/api";

// All client requests are rewritten to /api/proxy/* so the orchestrator URL
// is never exposed to the browser.
const proxied: Api = api({
  baseUrl: "",
  fetch: (input, init) => fetch(input.replace(/^\/api\//, "/api/proxy/"), init),
});

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
