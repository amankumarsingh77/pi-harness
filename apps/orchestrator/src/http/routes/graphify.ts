import type { FastifyInstance } from "fastify";
import type { GraphifyAutoInstaller } from "../../agents/graphify-installer.js";

export type GraphifyRouteDeps = {
  readonly installer?: Pick<GraphifyAutoInstaller, "status">;
};

export function registerGraphifyRoutes(app: FastifyInstance, deps: GraphifyRouteDeps): void {
  app.get("/api/graphify/status", async () => ({
    status: deps.installer ? await deps.installer.status() : null,
  }));
}
