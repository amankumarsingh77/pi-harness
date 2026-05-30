import type { FastifyInstance } from "fastify";
import { buildModelCatalog } from "@pi-harness/pi-bridge";

export function registerModelOptionRoutes(app: FastifyInstance): void {
  app.get("/api/model-options", async () => buildModelCatalog());
}
