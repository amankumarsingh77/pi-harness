"use client";

import Link from "next/link";
import type { Route } from "next";
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, Gauge, RefreshCw, Rocket, Route as RouteIcon, ShieldCheck, SlidersHorizontal, Zap } from "lucide-react";
import {
  DEFAULT_PHASE_MODELS,
  PHASES,
  type Phase,
  type PhaseModelConfig,
  type ThinkingLevel,
} from "@pi-harness/shared";
import type { Provider } from "@/lib/api";
import { Alert } from "@/components/ui/alert";

type Catalog = { providers: readonly Provider[] };

const PHASE_LABELS: Record<Phase, string> = {
  brainstorm: "Brainstorm",
  plan: "Planning",
  code: "Coder",
  verify: "Verify",
  pr: "PR",
};

type Selection = Record<Phase, { provider: string; model: string; thinkingLevel: ThinkingLevel }>;

type MissingCredential = {
  phase: Phase;
  provider: Provider;
};

type ModelPreset = "balanced" | "fast" | "high-confidence" | "custom";

type RefreshState = "idle" | "refreshing" | "failed";

type PresetDefinition = {
  readonly id: Exclude<ModelPreset, "custom">;
  readonly label: string;
  readonly description: string;
  readonly icon: React.ComponentType<{ readonly size?: number; readonly strokeWidth?: number; readonly className?: string }>;
};

const PRESETS: readonly PresetDefinition[] = [
  {
    id: "balanced",
    label: "Balanced",
    description: "Default routing for everyday implementation work.",
    icon: Gauge,
  },
  {
    id: "fast",
    label: "Fast",
    description: "Prefer lower-cost or smaller models when the catalog offers them.",
    icon: Zap,
  },
  {
    id: "high-confidence",
    label: "High confidence",
    description: "Prefer larger reasoning models and stronger planning/verify settings.",
    icon: ShieldCheck,
  },
];

export function StageModelSelector({
  initialCatalog,
  fetchCatalog = defaultFetchCatalog,
}: {
  initialCatalog: Catalog;
  fetchCatalog?: () => Promise<Catalog>;
}) {
  const [catalog, setCatalog] = useState(initialCatalog);
  const [selection, setSelection] = useState<Selection>(() => initialSelection(initialCatalog));
  const [preset, setPreset] = useState<ModelPreset>("balanced");
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
      setSelection((current) =>
        preset === "custom"
          ? reconcileSelection(current, next)
          : presetSelection(next, preset),
      );
      setRefreshState("idle");
    } catch {
      setRefreshState("failed");
    }
  };

  return (
    <section
      role="region"
      className="mt-5 border-t border-line pt-5"
      aria-label="Stage model routing"
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="stage-models-heading" className="m-0 flex items-center gap-2 text-[14px] font-semibold text-fg">
            <RouteIcon size={15} strokeWidth={1.8} className="text-st-progress" aria-hidden="true" />
            Stage models
          </h2>
          <p className="m-0 mt-1 text-[12.5px] leading-[1.45] text-fg-mute">
            Planning selection also drives pre-flight agents.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshState === "refreshing"}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-line bg-transparent px-3 text-[12px] font-medium text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw
            size={13}
            strokeWidth={1.9}
            className={refreshState === "refreshing" ? "animate-spin" : ""}
            aria-hidden="true"
          />
          {refreshState === "refreshing" ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <input type="hidden" name="phaseModels" value={JSON.stringify(reconciledSelection)} />

      <div className="grid gap-2 md:grid-cols-3">
        {PRESETS.map((option) => (
          <PresetButton
            key={option.id}
            preset={option}
            active={preset === option.id}
            onClick={() => {
              setPreset(option.id);
              setSelection(presetSelection(catalog, option.id));
              setAdvancedOpen(false);
            }}
          />
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-line bg-input/35">
        <button
          type="button"
          className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((current) => !current)}
        >
          <SlidersHorizontal size={14} strokeWidth={1.8} className="text-fg-mute" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-fg">Advanced stage routing</div>
            <div className="mt-0.5 truncate font-mono text-[10.5px] text-fg-faint">
              {preset === "custom" ? "custom per-stage model overrides" : summaryFor(reconciledSelection)}
            </div>
          </div>
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-fg-mute">
            {preset === "custom" ? "custom" : presetLabel(preset)}
          </span>
          <ChevronDown
            size={14}
            strokeWidth={1.8}
            className={advancedOpen ? "rotate-180 text-fg-mute transition-transform" : "text-fg-mute transition-transform"}
            aria-hidden="true"
          />
        </button>

        {advancedOpen && (
          <div className="grid gap-3 border-t border-line p-3 md:grid-cols-2">
            {PHASES.map((phase) => {
              const phaseSelection = reconciledSelection[phase];
              const provider = providerById(catalog, phaseSelection.provider) ?? catalog.providers[0];
              const models = provider?.models ?? [];
              const selectedModel = models.find((model) => model.id === phaseSelection.model);
              return (
                <article
                  key={phase}
                  aria-label={`${PHASE_LABELS[phase]} model stage`}
                  className="rounded-lg border border-line bg-card p-3.5 transition-colors hover:border-line-hover"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="m-0 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-body">
                        {PHASE_LABELS[phase]}
                      </h3>
                      <p className="m-0 mt-1 truncate text-[12px] text-fg-mute">
                        {selectedModel?.name ?? "No model selected"}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-line bg-white/[0.02] px-2 py-0.5 font-mono text-[10px] text-fg-faint">
                      {models.length > 0 ? `${models.length} models` : "no models"}
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ModelSelect
                      label="Provider"
                      ariaLabel={`${PHASE_LABELS[phase]} provider`}
                      value={phaseSelection.provider}
                      onChange={(nextProvider) => {
                        setPreset("custom");
                        setSelection((current) => ({
                          ...current,
                          [phase]: firstSelectionForProvider(catalog, nextProvider),
                        }));
                      }}
                    >
                      {catalog.providers.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </ModelSelect>
                    <ModelSelect
                      label="Model"
                      ariaLabel={`${PHASE_LABELS[phase]} model`}
                      value={phaseSelection.model}
                      onChange={(nextModel) => {
                        setPreset("custom");
                        setSelection((current) => ({
                          ...current,
                          [phase]: { ...current[phase], model: nextModel },
                        }));
                      }}
                    >
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </ModelSelect>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {(missing.length > 0 || refreshState === "failed" || !hasProviders) && (
        <div className="mt-3">
          <Alert tone="info" title="Provider key required" label="Provider credentials required">
            <p className="m-0">
              {warningText({ missing, refreshState, hasProviders })}
            </p>
          </Alert>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center">
        <span className="flex-1 font-mono text-[11px] leading-[1.6] text-fg-subtle">
          Creating a task does <span className="text-fg-body">not</span> start a run — no
          worktree, no LLM tokens spent.
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={"/" as Route}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-transparent px-3.5 text-[13px] font-medium text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03]"
          >
            <ArrowLeft size={14} strokeWidth={1.8} aria-hidden="true" />
            Cancel
          </Link>
          <button
            type="submit"
            disabled={blocked}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border-0 bg-st-progress px-3.5 text-[13px] font-medium text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
          >
            <Rocket size={14} strokeWidth={1.8} aria-hidden="true" />
            Create task
          </button>
        </div>
      </div>
    </section>
  );
}

function PresetButton({
  preset,
  active,
  onClick,
}: {
  readonly preset: PresetDefinition;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  const Icon = preset.icon;
  return (
    <button
      type="button"
      aria-pressed={active}
      className={
        active
          ? "rounded-lg border border-st-progress/45 bg-st-progress/[0.08] p-3 text-left text-fg"
          : "rounded-lg border border-line bg-input/35 p-3 text-left text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03]"
      }
      onClick={onClick}
    >
      <span className="flex items-center gap-2 text-[13px] font-medium">
        <Icon size={14} strokeWidth={1.9} className={active ? "text-st-progress" : "text-fg-mute"} aria-hidden="true" />
        {preset.label}
      </span>
      <span className="mt-1 block text-[12px] leading-5 text-fg-mute">{preset.description}</span>
    </button>
  );
}

function ModelSelect({
  label,
  ariaLabel,
  value,
  onChange,
  children,
}: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.05em] text-fg-faint">
        {label}
      </span>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-line bg-card px-2.5 text-[13px] text-fg outline-none transition-colors focus:border-st-progress"
      >
        {children}
      </select>
    </label>
  );
}

async function defaultFetchCatalog(): Promise<Catalog> {
  const response = await fetch("/api/proxy/providers", {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("model catalog unavailable");
  return (await response.json()) as Catalog;
}

function initialSelection(catalog: Catalog): Selection {
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
    brainstorm: { provider: "", model: "", thinkingLevel: "medium" },
    plan: { provider: "", model: "", thinkingLevel: "high" },
    code: { provider: "", model: "", thinkingLevel: "medium" },
    verify: { provider: "", model: "", thinkingLevel: "high" },
    pr: { provider: "", model: "", thinkingLevel: "off" },
  };
}

function reconcileSelection(selection: Selection, catalog: Catalog): Selection {
  return PHASES.reduce<Selection>(
    (acc, phase) => ({
      ...acc,
      [phase]: selectExistingOrFallback(catalog, selection[phase]),
    }),
    emptySelection(),
  );
}

function selectExistingOrFallback(
  catalog: Catalog,
  requested: Pick<PhaseModelConfig, "provider" | "model">,
): { provider: string; model: string; thinkingLevel: ThinkingLevel } {
  const provider = providerById(catalog, requested.provider) ?? catalog.providers[0];
  if (provider === undefined) {
    return {
      provider: "",
      model: "",
      thinkingLevel: thinkingLevelFromRequest(requested),
    };
  }
  const model = provider.models.find((candidate) => candidate.id === requested.model) ?? provider.models[0];
  return {
    provider: provider.id,
    model: model?.id ?? "",
    thinkingLevel: thinkingLevelFromRequest(requested),
  };
}

function providerById(catalog: Catalog, id: string): Provider | undefined {
  return catalog.providers.find((provider) => provider.id === id);
}

function firstSelectionForProvider(
  catalog: Catalog,
  providerId: string,
): { provider: string; model: string; thinkingLevel: ThinkingLevel } {
  const provider = providerById(catalog, providerId) ?? catalog.providers[0];
  return {
    provider: provider?.id ?? "",
    model: provider?.models[0]?.id ?? "",
    thinkingLevel: "medium",
  };
}

function presetSelection(catalog: Catalog, preset: ModelPreset): Selection {
  if (preset === "custom") return initialSelection(catalog);
  return PHASES.reduce<Selection>(
    (acc, phase) => ({
      ...acc,
      [phase]: selectionForPresetPhase({ catalog, preset, phase }),
    }),
    emptySelection(),
  );
}

function selectionForPresetPhase({
  catalog,
  preset,
  phase,
}: {
  readonly catalog: Catalog;
  readonly preset: Exclude<ModelPreset, "custom">;
  readonly phase: Phase;
}): Selection[Phase] {
  const base = DEFAULT_PHASE_MODELS[phase];
  const provider = providerById(catalog, base.provider) ?? catalog.providers[0];
  if (provider === undefined) {
    return selectExistingOrFallback(catalog, base);
  }
  const model =
    preset === "fast"
      ? pickFastModel(provider)
      : preset === "high-confidence"
        ? pickHighConfidenceModel(provider)
        : provider.models.find((candidate) => candidate.id === base.model) ?? provider.models[0];

  return {
    provider: provider.id,
    model: model?.id ?? "",
    thinkingLevel: thinkingLevelForPreset(preset, phase),
  };
}

function pickFastModel(provider: Provider): Provider["models"][number] | undefined {
  return [...provider.models].sort((a, b) => modelSpeedScore(b) - modelSpeedScore(a))[0];
}

function pickHighConfidenceModel(provider: Provider): Provider["models"][number] | undefined {
  return [...provider.models].sort((a, b) => modelConfidenceScore(b) - modelConfidenceScore(a))[0];
}

function modelSpeedScore(model: Provider["models"][number]): number {
  const text = `${model.id} ${model.name}`.toLowerCase();
  const nameScore =
    (text.includes("mini") ? 5 : 0) +
    (text.includes("flash") ? 5 : 0) +
    (text.includes("haiku") ? 4 : 0) +
    (text.includes("fast") ? 4 : 0) +
    (text.includes("lite") ? 3 : 0);
  const costScore = model.cost.input + model.cost.output === 0 ? 0 : 10 / (model.cost.input + model.cost.output);
  return nameScore + costScore;
}

function modelConfidenceScore(model: Provider["models"][number]): number {
  const text = `${model.id} ${model.name}`.toLowerCase();
  const nameScore =
    (text.includes("opus") ? 6 : 0) +
    (text.includes("sonnet") ? 5 : 0) +
    (text.includes("gpt-5") ? 5 : 0) +
    (text.includes("reason") ? 4 : 0) +
    (text.includes("pro") ? 3 : 0);
  return nameScore + (model.reasoning ? 5 : 0) + model.contextWindow / 100_000;
}

function thinkingLevelForPreset(
  preset: Exclude<ModelPreset, "custom">,
  phase: Phase,
): ThinkingLevel {
  if (preset === "fast") return phase === "pr" ? "off" : "low";
  if (preset === "high-confidence") return phase === "pr" ? "medium" : "high";
  return DEFAULT_PHASE_MODELS[phase].thinkingLevel;
}

function thinkingLevelFromRequest(
  requested: Pick<PhaseModelConfig, "provider" | "model"> | PhaseModelConfig,
): ThinkingLevel {
  return "thinkingLevel" in requested ? requested.thinkingLevel : "medium";
}

function summaryFor(selection: Selection): string {
  const uniqueModels = new Set(PHASES.map((phase) => selection[phase].model).filter(Boolean));
  if (uniqueModels.size === 0) return "no models selected";
  if (uniqueModels.size === 1) return `${PHASES.length} stages · ${[...uniqueModels][0]}`;
  return `${PHASES.length} stages · ${uniqueModels.size} model routes`;
}

function presetLabel(preset: ModelPreset): string {
  switch (preset) {
    case "balanced":
      return "balanced";
    case "fast":
      return "fast";
    case "high-confidence":
      return "high confidence";
    case "custom":
      return "custom";
  }
}

function missingCredentials(selection: Selection, catalog: Catalog): readonly MissingCredential[] {
  return PHASES.flatMap((phase) => {
    const provider = providerById(catalog, selection[phase].provider);
    if (provider === undefined || provider.authenticated) return [];
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
  const unique = new Map<string, Provider>();
  for (const item of input.missing) unique.set(item.provider.id, item.provider);
  const details = [...unique.values()].map((provider) => credentialText(provider)).join("; ");
  return `${details}. Add the credential first, then click Refresh.`;
}

function credentialText(provider: Provider): string {
  if (provider.auth === "oauth") {
    return `${provider.name} needs a subscription login (run /login in pi)`;
  }
  if (provider.requiredEnvVars.length > 0) {
    return `${provider.name} needs ${provider.requiredEnvVars.join(" or ")}`;
  }
  return `${provider.name} needs its credentials configured in the Pi environment`;
}
