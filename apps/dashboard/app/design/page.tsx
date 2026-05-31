import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { DesignSystemView } from "@/components/design/design-system-view";
import { ApiError, type DesignSystemSnapshot } from "@/lib/api";
import { orchestrator } from "@/lib/server/api";

export const metadata: Metadata = {
  title: "design system · pi-harness",
};

const EMPTY: DesignSystemSnapshot = {
  exists: false,
  tokensCss: "",
  designMd: "",
  manifest: { tokenVersion: 0, updatedAt: "", exemplars: [], history: [] },
};

export default async function DesignSystemPage() {
  const snapshot = await orchestrator.getDesignSystem().catch((e) => {
    // Soft-fail an unreachable/absent design system to the empty state rather
    // than crashing the route — the page renders the seed instruction below.
    if (e instanceof ApiError && (e.status === 404 || e.status === 503)) return EMPTY;
    throw e;
  });

  return (
    <>
      <Topbar runningCount={0} branch="main" />
      <section className="min-h-[calc(100vh-44px)] bg-bg">
        {snapshot.exists ? (
          <DesignSystemView snapshot={snapshot} />
        ) : (
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-10">
            <h1 className="text-[15px] font-semibold text-fg">Design system</h1>
            <p className="text-[12px] text-fg-mute">
              No design system yet — promote a mock from a brainstorm to seed tokens v1.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
