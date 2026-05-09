import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { NotFoundError, ValidationError } from "../../domain/errors.js";

const ALLOWED = new Set(["brainstorm", "plan", "proof-report"]);

// File names on disk for each allowed key.
const FILE_FOR: Record<string, { rel: string }> = {
  brainstorm: { rel: "brainstorm.json" },
  plan: { rel: "plan.json" },
  "proof-report": { rel: "proof/proof-report.json" },
};

export function registerArtifactRoutes(
  app: FastifyInstance,
  deps: { runsDir: string },
): void {
  app.get<{ Params: { id: string; name: string } }>(
    "/api/tasks/:id/artifacts/:name",
    async (req, reply) => {
      const { id, name } = req.params;
      if (!ALLOWED.has(name)) throw new ValidationError(`unknown artifact: ${name}`);

      const path = join(deps.runsDir, id, FILE_FOR[name]!.rel);
      // Defense in depth: ensure resolved path is still under runsDir.
      if (!resolve(path).startsWith(resolve(deps.runsDir))) {
        throw new ValidationError("path traversal rejected");
      }

      try {
        const raw = await readFile(path, "utf8");
        reply.type("application/json");
        return reply.send(raw);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          throw new NotFoundError(`artifact:${name}`, id);
        }
        throw e;
      }
    },
  );
}
