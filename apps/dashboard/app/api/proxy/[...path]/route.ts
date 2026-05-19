import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORCHESTRATOR = process.env.ORCHESTRATOR_URL ?? "http://localhost:4000";

// Errors we treat as transient infrastructure issues — the orchestrator is
// down, restarting, or the upstream socket dropped because the client
// disconnected. We map these to a clean 503 with no stack trace so the dev
// console isn't flooded with red text every time `pnpm dev` HMR-cycles the
// orchestrator. The client (TanStack Query / EventSource) already retries.
function isTransientFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  if (msg === "fetch failed" || msg === "terminated") return true;
  // undici nests the real cause; walk one level.
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  if (cause?.code === "ECONNREFUSED" || cause?.code === "UND_ERR_SOCKET") return true;
  if (cause?.message === "other side closed") return true;
  return false;
}

async function proxy(req: NextRequest, params: { path: string[] }): Promise<Response> {
  const tail = params.path.join("/");
  const url = `${ORCHESTRATOR}/api/${tail}${req.nextUrl.search}`;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const init: RequestInit = {
    method: req.method,
    headers: req.headers,
    // Propagate browser disconnects upstream so the orchestrator's request
    // cleanly aborts instead of being torn down mid-pipe.
    signal: req.signal,
    ...(hasBody ? { body: await req.text() } : {}),
  };
  try {
    const res = await fetch(url, init);
    return new Response(res.body, { status: res.status, headers: res.headers });
  } catch (err) {
    if (isTransientFetchError(err)) {
      return new Response(
        JSON.stringify({ error: "upstream_unavailable", message: "orchestrator unreachable" }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    }
    throw err;
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await ctx.params);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await ctx.params);
}
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await ctx.params);
}
