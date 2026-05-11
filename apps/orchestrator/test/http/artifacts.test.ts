import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@pi-harness/db";
import { RunStore } from "../../src/adapters/run-store.js";
import { EventStore } from "../../src/adapters/event-store.js";
import { buildServer } from "../../src/http/server.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:54330/piharness";

describe("/api/tasks/:id/artifacts and /screenshots", () => {
  const { db, client } = createDb(url);
  const runs = new RunStore(db);
  const events = new EventStore(db);
  let runsDir: string;

  beforeEach(async () => {
    await db.execute("delete from tasks");
    runsDir = await mkdtemp(join(tmpdir(), "runs-"));
  });

  afterAll(async () => {
    await client.end();
    if (runsDir) await rm(runsDir, { recursive: true, force: true });
  });

  it("returns brainstorm artifact JSON", async () => {
    const t = await runs.createTask({ title: "x" });
    const taskDir = join(runsDir, t.id);
    await mkdir(taskDir, { recursive: true });
    await writeFile(
      join(taskDir, "brainstorm.json"),
      JSON.stringify({ goal: "g", decisions: [], openQuestions: [], suggestedWorkflow: "backend-feature", transcript: [] }),
    );

    const app = buildServer({ runs, events, runsDir });
    await app.ready();

    const res = await app.inject({ method: "GET", url: `/api/tasks/${t.id}/artifacts/brainstorm` });
    expect(res.statusCode).toBe(200);
    expect(res.json().goal).toBe("g");

    await app.close();
  });

  it("returns 404 when artifact is missing", async () => {
    const t = await runs.createTask({ title: "y" });
    const app = buildServer({ runs, events, runsDir });
    await app.ready();

    const res = await app.inject({ method: "GET", url: `/api/tasks/${t.id}/artifacts/plan` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it("serves screenshot files with image/png", async () => {
    const t = await runs.createTask({ title: "z" });
    const shotDir = join(runsDir, t.id, "proof", "screenshots");
    await mkdir(shotDir, { recursive: true });
    // Minimal 1x1 png
    const PNG = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
      "hex",
    );
    await writeFile(join(shotDir, "test.png"), PNG);

    const app = buildServer({ runs, events, runsDir });
    await app.ready();

    const res = await app.inject({ method: "GET", url: `/api/tasks/${t.id}/proof/screenshots/test.png` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");

    await app.close();
  });

  it("rejects path traversal", async () => {
    const t = await runs.createTask({ title: "p" });
    const app = buildServer({ runs, events, runsDir });
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: `/api/tasks/${t.id}/proof/screenshots/..%2F..%2Fetc%2Fpasswd`,
    });
    expect([400, 404]).toContain(res.statusCode);

    await app.close();
  });
});
