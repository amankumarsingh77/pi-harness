"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileJson, GitBranch, Network, RefreshCw, Route, ScanSearch } from "lucide-react";
import { clsx } from "clsx";
import { ArtifactMarkdown } from "@/components/artifact-markdown";
import { mutations, queries, queryKeys } from "@/lib/client/queries";
import type { GraphifyAction, GraphifyStatus } from "@/lib/api";

type KnowledgeTab = "report" | "html" | "callflow" | "tree" | "json";

const TABS: readonly {
  readonly id: KnowledgeTab;
  readonly label: string;
  readonly icon: typeof FileJson;
}[] = [
  { id: "report", label: "Report", icon: ScanSearch },
  { id: "html", label: "Interactive Graph", icon: Network },
  { id: "callflow", label: "Call Flow", icon: Route },
  { id: "tree", label: "Tree", icon: GitBranch },
  { id: "json", label: "Raw JSON", icon: FileJson },
];

export function GraphifyKnowledge({
  initialStatus,
  initialReport,
}: {
  readonly initialStatus: GraphifyStatus;
  readonly initialReport: string | null;
}) {
  const [active, setActive] = useState<KnowledgeTab>("report");
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    ...queries.getGraphifyStatus(),
    initialData: initialStatus,
    staleTime: 2_000,
    refetchInterval: (query) =>
      query.state.data?.job.status === "running" ? 2_500 : false,
  });
  const reportQuery = useQuery({
    ...queries.getGraphifyReport(),
    initialData: initialReport ?? undefined,
    staleTime: 2_000,
    enabled: statusQuery.data.reportExists,
  });
  const actionMutation = useMutation({
    ...mutations.runGraphifyAction(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.graphifyStatus });
      await queryClient.invalidateQueries({ queryKey: queryKeys.graphifyReport });
    },
  });
  const status = statusQuery.data;
  const running = status.job.status === "running" || actionMutation.isPending;
  const activeAvailable = hasArtifact(status, active);
  const statusTone = status.job.status === "failed"
    ? "blocked"
    : status.graphExists
      ? "ready"
      : status.job.status === "running"
        ? "running"
        : "missing";

  const runAction = (action: GraphifyAction): void => {
    actionMutation.mutate(action);
  };

  return (
    <main className="mx-auto max-w-[1220px] px-4 py-6 md:px-7">
      <section className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-faint">
            <span className="h-1.5 w-1.5 rotate-45 bg-fg-faint" />
            repo knowledge graph
          </div>
          <h1 className="m-0 text-[26px] font-semibold leading-tight text-fg md:text-[30px]">
            Knowledge
          </h1>
        </div>
        <div className="flex flex-wrap items-start gap-2 xl:justify-end">
          <ActionButton
            icon={RefreshCw}
            disabled={running || !status.enabled}
            onClick={() => runAction("update")}
          >
            Update graph
          </ActionButton>
          <ActionButton
            icon={ScanSearch}
            disabled={running || !status.enabled}
            onClick={() => runAction("rebuild")}
          >
            Full rebuild
          </ActionButton>
          <ActionButton
            icon={Download}
            disabled={running || !status.enabled || !status.graphExists}
            onClick={() => runAction("export")}
          >
            Export HTML
          </ActionButton>
        </div>
      </section>

      <section className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-6">
        <StatusCell label="service" value={status.enabled ? "enabled" : "disabled"} tone={status.enabled ? "ready" : "missing"} />
        <StatusCell label="install" value={status.installed ? status.version ?? "installed" : "missing"} tone={status.installed ? "ready" : "blocked"} />
        <StatusCell label="graph" value={status.graphExists ? "ready" : "missing"} tone={statusTone} />
        <StatusCell label="report" value={status.reportExists ? "ready" : "missing"} tone={status.reportExists ? "ready" : "missing"} />
        <StatusCell label="json" value={formatBytes(status.jsonBytes)} tone={status.jsonBytes ? "ready" : "missing"} />
        <StatusCell label="job" value={jobLabel(status)} tone={statusTone} />
      </section>

      {status.job.error && (
        <div className="mb-4 rounded-[8px] border border-st-blocked/35 bg-red-bg/25 px-3 py-2.5 font-mono text-[11px] text-red-fg">
          {status.job.error}
        </div>
      )}

      <section className="overflow-hidden rounded-[9px] border border-line bg-card">
        <div className="flex gap-1 overflow-x-auto border-b border-line p-2">
          {TABS.map((tab) => (
            <TabButton
              key={tab.id}
              active={active === tab.id}
              available={hasArtifact(status, tab.id)}
              icon={tab.icon}
              onClick={() => setActive(tab.id)}
            >
              {tab.label}
            </TabButton>
          ))}
        </div>
        <div className="min-h-[580px]">
          <KnowledgeBody
            active={active}
            available={activeAvailable}
            report={reportQuery.data ?? null}
            reportLoading={reportQuery.isPending}
            status={status}
          />
        </div>
      </section>
    </main>
  );
}

function KnowledgeBody({
  active,
  available,
  report,
  reportLoading,
  status,
}: {
  readonly active: KnowledgeTab;
  readonly available: boolean;
  readonly report: string | null;
  readonly reportLoading: boolean;
  readonly status: GraphifyStatus;
}) {
  if (active === "report") {
    if (!status.reportExists) return <EmptyArtifact title="Graphify report is not available yet" />;
    if (reportLoading) return <EmptyArtifact title="Loading report" />;
    if (!report) return <EmptyArtifact title="Graphify report is not available yet" />;
    return (
      <div className="scroll-hide max-h-[760px] overflow-y-auto px-5 py-5 md:px-7">
        <ArtifactMarkdown>{report}</ArtifactMarkdown>
      </div>
    );
  }
  if (active === "json") {
    return (
      <div className="grid min-h-[580px] place-items-center px-5 py-8">
        <div className="w-full max-w-[560px] rounded-[8px] border border-line bg-white/[0.018] p-4">
          <div className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-fg">
            <FileJson size={16} />
            graph.json
          </div>
          <p className="m-0 mb-4 text-[12.5px] leading-6 text-fg-mute">
            {status.jsonBytes
              ? `Graph JSON is ${formatBytes(status.jsonBytes)}. Open it directly when you need raw node and edge data.`
              : "Graph JSON has not been generated yet."}
          </p>
          {status.jsonBytes ? (
            <a
              href="/api/proxy/graphify/artifacts/json"
              className="inline-flex h-8 items-center gap-2 rounded-[7px] border border-line px-3 text-[12px] text-fg-body transition hover:border-line-hover hover:bg-white/[0.045]"
            >
              <Download size={14} />
              Open JSON
            </a>
          ) : (
            <span className="inline-flex h-8 items-center gap-2 rounded-[7px] border border-line px-3 text-[12px] text-fg-mute opacity-45">
              <Download size={14} />
              Open JSON
            </span>
          )}
        </div>
      </div>
    );
  }
  if (!available) return <EmptyArtifact title={`${labelFor(active)} is not available yet`} />;
  return (
    <iframe
      title={labelFor(active)}
      src={`/api/proxy/graphify/artifacts/${active}`}
      sandbox="allow-scripts allow-same-origin"
      className="h-[760px] w-full border-0 bg-white"
    />
  );
}

function EmptyArtifact({ title }: { readonly title: string }) {
  return (
    <div className="grid min-h-[580px] place-items-center px-6 py-8">
      <div className="max-w-[420px] rounded-[8px] border border-dashed border-line px-4 py-5 text-center">
        <p className="m-0 text-[13px] font-medium text-fg">{title}</p>
      </div>
    </div>
  );
}

function StatusCell({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone: "ready" | "running" | "blocked" | "missing";
}) {
  return (
    <div className="rounded-[8px] border border-line bg-card px-3 py-2.5">
      <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-faint">
        {label}
      </div>
      <div className={clsx("truncate font-mono text-[12px]", toneClass(tone))}>{value}</div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  disabled,
  onClick,
  children,
}: {
  readonly icon: typeof RefreshCw;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 items-center gap-2 rounded-[7px] border border-line bg-white/[0.025] px-3 text-[12px] font-medium text-fg-body transition hover:-translate-y-px hover:border-line-hover hover:bg-white/[0.05] disabled:pointer-events-none disabled:opacity-45"
    >
      <Icon size={14} />
      {children}
    </button>
  );
}

function TabButton({
  active,
  available,
  icon: Icon,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly available: boolean;
  readonly icon: typeof FileJson;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="inline-flex h-8 shrink-0 items-center gap-2 rounded-[7px] px-3 text-[12px] text-fg-mute transition hover:bg-white/[0.045] hover:text-fg-body aria-pressed:bg-white/[0.055] aria-pressed:text-fg"
    >
      <Icon size={14} />
      <span>{children}</span>
      <span className={clsx("h-1.5 w-1.5 rounded-full", available ? "bg-st-done" : "bg-fg-faint")} />
    </button>
  );
}

function hasArtifact(status: GraphifyStatus, tab: KnowledgeTab): boolean {
  if (tab === "report") return status.reportExists;
  if (tab === "html") return status.htmlExists;
  if (tab === "callflow") return status.callflowExists;
  if (tab === "tree") return status.treeExists;
  return status.jsonBytes !== null;
}

function labelFor(tab: KnowledgeTab): string {
  if (tab === "html") return "Interactive Graph";
  if (tab === "callflow") return "Call Flow";
  if (tab === "tree") return "Tree";
  if (tab === "json") return "Raw JSON";
  return "Report";
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "missing";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function jobLabel(status: GraphifyStatus): string {
  if (status.job.status === "running" && status.job.action) return `${status.job.action} running`;
  if (status.job.status === "failed") return "failed";
  if (status.job.completedAt) return `last ${status.job.action ?? "job"}`;
  return "idle";
}

function toneClass(tone: "ready" | "running" | "blocked" | "missing"): string {
  if (tone === "ready") return "text-st-done";
  if (tone === "running") return "text-st-progress";
  if (tone === "blocked") return "text-st-blocked";
  return "text-fg-mute";
}
