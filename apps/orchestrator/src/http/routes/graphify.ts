import type { FastifyInstance } from "fastify";
import type { GraphifyAction, GraphifyArtifactKind, GraphifyService } from "../../services/graphify-service.js";

const ARTIFACT_KINDS: readonly GraphifyArtifactKind[] = [
  "report",
  "html",
  "callflow",
  "tree",
  "json",
];

const ACTIONS: readonly Exclude<GraphifyAction, "bootstrap" | "initial-build">[] = [
  "update",
  "rebuild",
  "export",
];

export function registerGraphifyRoutes(
  app: FastifyInstance,
  deps: { readonly graphify: GraphifyService },
): void {
  app.get("/api/graphify/status", async () => deps.graphify.getStatus());

  app.get("/api/graphify/report", async (_req, reply) => {
    const artifact = await deps.graphify.readArtifact("report");
    if (artifact === null) {
      reply.code(404);
      return { error: "not_found", message: "Graphify report artifact not found" };
    }
    reply.header("content-type", artifact.contentType);
    return artifact.body;
  });

  app.get<{ Params: { kind: string } }>(
    "/api/graphify/artifacts/:kind",
    async (req, reply) => {
      const kind = parseArtifactKind(req.params.kind);
      if (kind === null) {
        reply.code(404);
        return { error: "not_found", message: "Graphify artifact not found" };
      }
      const artifact = await deps.graphify.readArtifact(kind);
      if (artifact === null) {
        reply.code(404);
        return { error: "not_found", message: "Graphify artifact not found" };
      }
      reply.header("content-type", artifact.contentType);
      reply.header("x-graphify-artifact-kind", artifact.kind);
      reply.header("x-graphify-artifact-bytes", String(artifact.bytes));
      return artifact.body;
    },
  );

  app.post<{ Params: { action: string } }>(
    "/api/graphify/actions/:action",
    async (req, reply) => {
      const action = parseAction(req.params.action);
      if (action === null) {
        reply.code(404);
        return { error: "not_found", message: "Graphify action not found" };
      }
      reply.code(202);
      return deps.graphify.startAction(action);
    },
  );
}

function parseArtifactKind(raw: string): GraphifyArtifactKind | null {
  return ARTIFACT_KINDS.find((kind) => kind === raw) ?? null;
}

function parseAction(raw: string): Exclude<GraphifyAction, "bootstrap" | "initial-build"> | null {
  return ACTIONS.find((action) => action === raw) ?? null;
}
