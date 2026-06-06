import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { GraphifyKnowledge } from "@/components/knowledge/graphify-knowledge";
import { ApiError } from "@/lib/api";
import { orchestrator } from "@/lib/server/api";

export const metadata: Metadata = { title: "Knowledge · pi-harness" };
export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const status = await orchestrator.getGraphifyStatus();
  const report = status.reportExists ? await getReportOrNull() : null;
  return (
    <>
      <Topbar />
      <GraphifyKnowledge initialStatus={status} initialReport={report} />
    </>
  );
}

async function getReportOrNull(): Promise<string | null> {
  try {
    return await orchestrator.getGraphifyReport();
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 503)) return null;
    throw e;
  }
}
