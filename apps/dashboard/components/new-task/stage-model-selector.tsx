"use client";

import Link from "next/link";
import type { Route } from "next";
import { useMemo, useState } from "react";
import {
  DEFAULT_PHASE_MODELS,
  PHASES,
  type Phase,
  type PhaseModelConfig,
} from "@pi-harness/shared";
import type { ModelCatalog, ModelCatalogProvider } from "@/lib/api";

const PHASE_LABELS: Record<Phase, string> = {
  brainstorm: "Brainstorm",
  plan: "Planning",
  code: "Coder",
  verify: "Verify",
  pr: "PR",
};

type Selection = Record<Phase, { provider: string; model: string }>;

type MissingCredential = {
  phase: Phase;
  provider: ModelCatalogProvider;
};

type RefreshState = "idle" | "refreshing" | "failed";

export function StageModelSelector({
  initialCatalog,
  fetchCatalog = defaultFetchCatalog,
}: {
  initialCatalog: ModelCatalog;
  fetchCatalog?: () => Promise<ModelCatalog>;
}) {
  const [catalog, setCatalog] = useState(initialCatalog);
  const [selection, setSelection] = useState<Selection>(() => initialSelection(initialCatalog));
  const [refreshState, setRefreshState] = useState<RefreshState>("idle");

  const reconciledSelection = useMemo(
    () => reconcileSelection(selection, catalog),
    [catalog, selection],
  );
  const missing = useMemo(
    () => missingCredentials(reconciledSelection, catalog),
    [catalog, reconciledSelection],
  );
  const hasProviders = catalog.providers.length > 0;
  const blocked = !hasProviders || missing.length > 0 || refreshState === "failed";

  const refresh = async (): Promise<void> => {
    setRefreshState("refreshing");
    try {
      const next = await fetchCatalog();
      setCatalog(next);
      setSelection((current) => reconcileSelection(current, next));
      setRefreshState("idle");
    } catch {
      setRefreshState("failed");
    }
  };

  return (
    <section className="mt-5 border-t border-line pt-5" aria-labelledby="stage-models-heading">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <div>
          <h2 id="stage-models-heading" className="m-0 text-[13px] font-semibold text-fg">
            Stage models
          </h2>
          <p className="m-0 mt-1 font-mono text-[11px] text-fg-subtle">
            Planning selection also drives pre-flight agents.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshState === "refreshing"}
          className="rounded-md border border-line bg-transparent px-3 py-1.5 text-[12px] font-medium text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refreshState === "refreshing" ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <input type="hidden" name="phaseModels" value={JSON.stringify(reconciledSelection)} />

      <div className="grid gap-2.5 md:grid-cols-2">
        {PHASES.map((phase) => {
          const phaseSelection = reconciledSelection[phase];
          const provider = providerById(catalog, phaseSelection.provider) ?? catalog.providers[0];
          const models = provider?.models ?? [];
          return (
            <div key={phase} className="rounded-md border border-line bg-input/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-fg-mute">
                  {PHASE_LABELS[phase]}
                </span>
                <span className="font-mono text-[10px] text-fg-faint">
                  {models.length > 0 ? `${models.length} models` : "no models"}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.04em] text-fg-faint">
                    Provider
                  </span>
                  <select
                    aria-label={`${PHASE_LABELS[phase]} provider`}
                    value={phaseSelection.provider}
                    onChange={(event) => {
                      const nextProvider = event.target.value;
                      setSelection((current) => ({
                        ...current,
                        [phase]: firstSelectionForProvider(catalog, nextProvider),
                      }));
                    }}
                    className="h-9 w-full rounded-md border border-line bg-card px-2 text-[13px] text-fg outline-none focus:border-st-progress"
                  >
                    {catalog.providers.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.04em] text-fg-faint">
                    Model
                  </span>
                  <select
                    aria-label={`${PHASE_LABELS[phase]} model`}
                    value={phaseSelection.model}
                    onChange={(event) => {
                      const nextModel = event.target.value;
                      setSelection((current) => ({
                        ...current,
                        [phase]: { ...current[phase], model: nextModel },
                      }));
                    }}
                    className="h-9 w-full rounded-md border border-line bg-card px-2 text-[13px] text-fg outline-none focus:border-st-progress"
                  >
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {(missing.length > 0 || refreshState === "failed" || !hasProviders) && (
        <div className="mt-3 rounded-md border border-amber-400/30 bg-amber-400/[0.08] px-3 py-2.5">
          <div className="flex items-start gap-2">
            <span className="mt-[3px] h-2 w-2 rounded-full bg-amber-300" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[13px] font-medium text-amber-100">Provider key required</p>
              <p className="m-0 mt-1 text-[12px] leading-[1.5] text-amber-100/80">
                {warningText({ missing, refreshState, hasProviders })}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center gap-2.5 border-t border-line pt-4">
        <span className="flex-1 font-mono text-[11px] leading-[1.6] text-fg-subtle">
          Creating a task does <span className="text-fg-body">not</span> start a run — no
          worktree, no LLM tokens spent.
        </span>
        <Link
          href={"/" as Route}
          className="rounded-md border border-line bg-transparent px-3.5 py-2 text-[13px] font-medium text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03]"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={blocked}
          className="rounded-md border-0 bg-st-progress px-3.5 py-2 text-[13px] font-medium text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
        >
          Create task
        </button>
      </div>
    </section>
  );
}

async function defaultFetchCatalog(): Promise<ModelCatalog> {
  const response = await fetch("/api/proxy/model-options", {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("model catalog unavailable");
  return (await response.json()) as ModelCatalog;
}

function initialSelection(catalog: ModelCatalog): Selection {
  return PHASES.reduce<Selection>(
    (acc, phase) => ({
      ...acc,
      [phase]: selectExistingOrFallback(catalog, DEFAULT_PHASE_MODELS[phase]),
    }),
    emptySelection(),
  );
}

function emptySelection(): Selection {
  return {
    brainstorm: { provider: "", model: "" },
    plan: { provider: "", model: "" },
    code: { provider: "", model: "" },
    verify: { provider: "", model: "" },
    pr: { provider: "", model: "" },
  };
}

function reconcileSelection(selection: Selection, catalog: ModelCatalog): Selection {
  return PHASES.reduce<Selection>(
    (acc, phase) => ({
      ...acc,
      [phase]: selectExistingOrFallback(catalog, selection[phase]),
    }),
    emptySelection(),
  );
}

function selectExistingOrFallback(
  catalog: ModelCatalog,
  requested: Pick<PhaseModelConfig, "provider" | "model">,
): { provider: string; model: string } {
  const provider = providerById(catalog, requested.provider) ?? catalog.providers[0];
  if (provider === undefined) return { provider: "", model: "" };
  const model = provider.models.find((candidate) => candidate.id === requested.model) ?? provider.models[0];
  return { provider: provider.id, model: model?.id ?? "" };
}

function providerById(catalog: ModelCatalog, id: string): ModelCatalogProvider | undefined {
  return catalog.providers.find((provider) => provider.id === id);
}

function firstSelectionForProvider(
  catalog: ModelCatalog,
  providerId: string,
): { provider: string; model: string } {
  const provider = providerById(catalog, providerId) ?? catalog.providers[0];
  return { provider: provider?.id ?? "", model: provider?.models[0]?.id ?? "" };
}

function missingCredentials(selection: Selection, catalog: ModelCatalog): readonly MissingCredential[] {
  return PHASES.flatMap((phase) => {
    const provider = providerById(catalog, selection[phase].provider);
    if (provider === undefined || provider.credential.configured) return [];
    return [{ phase, provider }];
  });
}

function warningText(input: {
  missing: readonly MissingCredential[];
  refreshState: RefreshState;
  hasProviders: boolean;
}): string {
  if (!input.hasProviders) return "No model providers are available. Refresh after configuring Pi providers.";
  if (input.refreshState === "failed") return "Could not refresh provider credentials. Check the orchestrator and try again.";
  const unique = new Map<string, ModelCatalogProvider>();
  for (const item of input.missing) unique.set(item.provider.id, item.provider);
  const details = [...unique.values()].map((provider) => credentialText(provider)).join("; ");
  return `${details}. Add the credential first, then click Refresh.`;
}

function credentialText(provider: ModelCatalogProvider): string {
  const credential = provider.credential;
  if (credential.kind === "env") {
    return `${provider.label} needs ${credential.requiredEnvVars.join(" or ")}`;
  }
  return `${provider.label}: ${credential.label}`;
}
