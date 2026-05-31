/**
 * providers.ts — the single provider/model catalog endpoint.
 *
 * GET /api/providers returns every provider + model pi supports (built-in and
 * custom), each flagged with whether a credential is configured, sourced from
 * pi-bridge's provider registry — the one source of truth. Both the new-task
 * stage selector and the chat model picker read this. (REQ-040, REQ-044)
 */

import type { FastifyInstance } from "fastify";
import type { Provider } from "@pi-harness/pi-bridge";

/** Enumerates every provider + model pi supports. Injectable for tests. */
export type ListProvidersFn = () => Provider[];

export type ProviderRouteDeps = {
  /**
   * Injectable provider catalog for tests. When absent, listProviders is
   * imported lazily from the bridge (production only — keeps the Node-only
   * bridge import chain out of test runs that don't need it).
   */
  readonly listProviders?: ListProvidersFn;
};

export function registerProviderRoutes(app: FastifyInstance, deps: ProviderRouteDeps = {}): void {
  app.get("/api/providers", async () => {
    const providers = deps.listProviders
      ? deps.listProviders()
      : await import("@pi-harness/pi-bridge").then((m) => m.listProviders());
    return { providers };
  });
}
