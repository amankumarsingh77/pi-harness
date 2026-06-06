import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { tmpdir } from "node:os";
import { buildServer } from "../../src/http/server.js";
import type {
  GraphifyAction,
  GraphifyArtifact,
  GraphifyArtifactKind,
  GraphifyCliResult,
  GraphifyService,
  GraphifyStatus,
} from "../../src/services/graphify-service.js";
import { createBareTestStores } from "../helpers/stores.js";

describe("/api/graphify", () => {
  it("returns Graphify status", async () => {
    const app = buildServer({
      ...createBareTestStores(),
      runsDir: tmpdir(),
      graphify: makeGraphifyService(),
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/graphify/status" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      enabled: true,
      installed: true,
      version: "0.8.32",
      graphExists: true,
    });
    await app.close();
  });

  it("serves the markdown report with an allowlisted content type", async () => {
    const app = buildServer({
      ...createBareTestStores(),
      runsDir: tmpdir(),
      graphify: makeGraphifyService({
        report: {
          kind: "report",
          path: "/tmp/GRAPH_REPORT.md",
          contentType: "text/markdown; charset=utf-8",
          bytes: 11,
          body: Buffer.from("# Repo\nBody"),
        },
      }),
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/graphify/report" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.body).toBe("# Repo\nBody");
    await app.close();
  });

  it("rejects unknown artifact names", async () => {
    const app = buildServer({
      ...createBareTestStores(),
      runsDir: tmpdir(),
      graphify: makeGraphifyService(),
    });
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/api/graphify/artifacts/../../etc/passwd",
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("dispatches update actions as accepted background jobs", async () => {
    const calls: GraphifyAction[] = [];
    const app = buildServer({
      ...createBareTestStores(),
      runsDir: tmpdir(),
      graphify: makeGraphifyService({ calls }),
    });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/graphify/actions/update",
    });

    expect(res.statusCode).toBe(202);
    expect(calls).toEqual(["update"]);
    await app.close();
  });
});

function makeGraphifyService(
  opts: {
    readonly calls?: GraphifyAction[];
    readonly report?: GraphifyArtifact;
  } = {},
): GraphifyService {
  const status: GraphifyStatus = {
    enabled: true,
    bootstrap: true,
    installed: true,
    version: "0.8.32",
    minVersion: "0.8.32",
    graphExists: true,
    reportExists: opts.report !== undefined,
    htmlExists: true,
    callflowExists: false,
    treeExists: false,
    jsonBytes: 128,
    job: {
      status: "idle",
      action: null,
      startedAt: null,
      completedAt: null,
      error: null,
    },
  };
  return {
    getStatus: () => Promise.resolve(status),
    bootstrap: () => Promise.resolve(status),
    startAction: (action) => {
      opts.calls?.push(action);
      return Promise.resolve(status);
    },
    readArtifact: (kind: GraphifyArtifactKind) =>
      Promise.resolve(kind === "report" ? opts.report ?? null : null),
    runQuery: (args): Promise<GraphifyCliResult> =>
      Promise.resolve({
        ok: true,
        stdout: args.join(" "),
        stderr: "",
        command: "graphify",
        args,
      }),
  };
}
