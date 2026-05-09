import { NextRequest } from "next/server";

const ORCHESTRATOR = process.env.ORCHESTRATOR_URL ?? "http://localhost:4000";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await ctx.params;
  const url = `${ORCHESTRATOR}/api/runs/${encodeURIComponent(runId)}/events/stream`;

  const upstream = await fetch(url, {
    method: "GET",
    headers: { accept: "text/event-stream" },
    signal: req.signal,
  });

  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  return new Response(upstream.body, { status: upstream.status, headers });
}
