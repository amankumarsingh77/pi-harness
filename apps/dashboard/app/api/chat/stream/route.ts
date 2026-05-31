/**
 * SSE proxy for the chat stream endpoint.
 *
 * Mirrors app/api/live/stream/route.ts exactly:
 *   - Passes through the request body and Last-Event-ID header.
 *   - Sets x-accel-buffering: no so nginx/Vercel does not buffer the stream.
 *   - Returns 503 on transient fetch errors (ECONNREFUSED, socket closed, etc.)
 *     so the client can show a graceful disconnected state.
 *
 * The threadId is a query param (not a path segment) because Next.js App Router
 * route handlers live at fixed paths. The client builds the URL via
 * buildChatStreamUrl(threadId) which sets ?threadId=<id>.
 *
 * Target: ${ORCHESTRATOR}/api/chat/threads/<threadId>/stream?after=<n>
 */

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
  const searchParams = req.nextUrl.searchParams;
  const threadId = searchParams.get("threadId");

  if (!threadId) {
    return new Response("threadId query param is required", { status: 400 });
  }

  // Forward the `after` param if present; strip `threadId` since it is part
  // of the path on the orchestrator side.
  const upstreamParams = new URLSearchParams();
  const after = searchParams.get("after");
  if (after) upstreamParams.set("after", after);

  const upstreamSearch = upstreamParams.size > 0 ? `?${upstreamParams.toString()}` : "";
  const url = `${ORCHESTRATOR}/api/chat/threads/${encodeURIComponent(threadId)}/stream${upstreamSearch}`;

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
