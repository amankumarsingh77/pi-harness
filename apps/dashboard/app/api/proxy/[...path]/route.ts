import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORCHESTRATOR = process.env.ORCHESTRATOR_URL ?? "http://localhost:4000";

async function proxy(req: NextRequest, params: { path: string[] }): Promise<Response> {
  const tail = params.path.join("/");
  const url = `${ORCHESTRATOR}/api/${tail}${req.nextUrl.search}`;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const init: RequestInit = hasBody
    ? { method: req.method, headers: req.headers, body: await req.text() }
    : { method: req.method, headers: req.headers };
  const res = await fetch(url, init);
  return new Response(res.body, { status: res.status, headers: res.headers });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await ctx.params);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await ctx.params);
}
