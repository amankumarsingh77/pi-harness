import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { NotFoundError, ValidationError } from "../../domain/errors.js";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export function registerScreenshotRoutes(
  app: FastifyInstance,
  deps: { runsDir: string },
): void {
  app.get<{ Params: { id: string; file: string } }>(
    "/api/tasks/:id/proof/screenshots/:file",
    async (req, reply) => {
      const { id, file } = req.params;
      if (!/^[A-Za-z0-9._-]+$/.test(file)) {
        throw new ValidationError("invalid screenshot filename");
      }

      const path = join(deps.runsDir, id, "proof", "screenshots", file);
      const baseDir = resolve(join(deps.runsDir, id, "proof", "screenshots"));
      if (!resolve(path).startsWith(baseDir)) {
        throw new ValidationError("path traversal rejected");
      }

      try {
        await stat(path);
      } catch {
        throw new NotFoundError("screenshot", `${id}/${file}`);
      }

      const mime = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
      reply.type(mime);
      return reply.send(createReadStream(path));
    },
  );
}
