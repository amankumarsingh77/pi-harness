import { NextRequest } from "next/server";

const ORCHESTRATOR = process.env.ORCHESTRATOR_URL ?? "http://localhost:4000";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isTransientFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  if (msg === "fetch failed" || msg === "terminated") return true;
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  if (cause?.code === "ECONNREFUSED" || cause?.code === "UND_ERR_SOCKET") return true;
  return cause?.message === "other side closed";
}

export async function GET(req: NextRequest): Promise<Response> {
  const url = `${ORCHESTRATOR}/api/live/stream${req.nextUrl.search}`;
  const lastEventId = req.headers.get("last-event-id");

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "GET",
      headers: {
        accept: "text/event-stream",
        ...(lastEventId ? { "last-event-id": lastEventId } : {}),
      },
      signal: req.signal,
    });
  } catch (err) {
    if (isTransientFetchError(err)) {
      return new Response("orchestrator unreachable", { status: 503 });
    }
    throw err;
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
