import { NextRequest } from "next/server";

const ORCHESTRATOR = process.env.ORCHESTRATOR_URL ?? "http://localhost:4000";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirrors proxy/[...path]/route.ts. Transient = orchestrator down / socket
// dropped because the client disconnected. We never want these to log a
// stack trace; the EventSource on the client retries on its own.
function isTransientFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  if (msg === "fetch failed" || msg === "terminated") return true;
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  if (cause?.code === "ECONNREFUSED" || cause?.code === "UND_ERR_SOCKET") return true;
  if (cause?.message === "other side closed") return true;
  return false;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await ctx.params;
  const url = `${ORCHESTRATOR}/api/runs/${encodeURIComponent(runId)}/events/stream`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "GET",
      headers: { accept: "text/event-stream" },
      // Propagate browser disconnects upstream — when the EventSource closes
      // (page nav, tab close), the orchestrator's request aborts cleanly
      // instead of being torn down mid-pipe.
      signal: req.signal,
    });
  } catch (err) {
    if (isTransientFetchError(err)) {
      return new Response("orchestrator unreachable", { status: 503 });
    }
    throw err;
  }

  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // Disable buffering by reverse proxies (nginx, etc.) so SSE frames
    // reach the browser as soon as the orchestrator emits them.
    "x-accel-buffering": "no",
  });

  return new Response(upstream.body, { status: upstream.status, headers });
}
