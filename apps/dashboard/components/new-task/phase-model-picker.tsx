"use client";

import { useMemo, useState } from "react";
import {
  PHASES,
  THINKING_LEVELS,
  type ModelCatalog,
  type ModelCatalogModel,
  type ModelCatalogProvider,
  type Phase,
  type PhaseModelConfig,
  type ThinkingLevel,
} from "@pi-harness/shared";

type PhaseModels = Record<Phase, PhaseModelConfig>;

const PHASE_LABELS: Record<Phase, string> = {
  brainstorm: "Brainstorm",
  plan: "Plan",
  code: "Code",
  verify: "Verify",
  pr: "PR",
};

export function PhaseModelPicker({ catalog }: { catalog: ModelCatalog }) {
  const [config, setConfig] = useState<PhaseModels>(() => initialConfig(catalog));
  const serialized = useMemo(() => JSON.stringify(config), [config]);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-input/30">
      <input type="hidden" name="phaseModels" value={serialized} />
      <div className="grid grid-cols-[112px_1fr_1.25fr_132px] gap-px bg-line text-[12px]">
        <HeaderCell>Phase</HeaderCell>
        <HeaderCell>Provider</HeaderCell>
        <HeaderCell>Model</HeaderCell>
        <HeaderCell>Thinking</HeaderCell>
        {PHASES.map((phase) => (
          <PhaseRow
            key={phase}
            phase={phase}
            catalog={catalog}
            value={config[phase]}
            onChange={(next) => setConfig((current) => ({ ...current, [phase]: next }))}
          />
        ))}
      </div>
    </div>
  );
}

function PhaseRow({
  phase,
  catalog,
  value,
  onChange,
}: {
  phase: Phase;
  catalog: ModelCatalog;
  value: PhaseModelConfig;
  onChange: (value: PhaseModelConfig) => void;
}) {
  const provider = findProvider(catalog, value.provider) ?? catalog.providers[0];
  const model = provider ? findModel(provider, value.model) ?? provider.models[0] : undefined;
  const thinkingLevels = model?.thinkingLevels ?? ["off"];

  return (
    <>
      <div className="bg-card px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-mute">
        {PHASE_LABELS[phase]}
      </div>
      <Cell>
        <select
          aria-label={`${PHASE_LABELS[phase]} provider`}
          value={provider?.id ?? ""}
          onChange={(event) => {
            const nextProvider = findProvider(catalog, event.target.value);
            const nextModel = nextProvider?.models[0];
            if (!nextProvider || !nextModel) return;
            onChange({
              provider: nextProvider.id,
              model: nextModel.id,
              thinkingLevel: safeThinkingLevel(nextModel, value.thinkingLevel),
            });
          }}
          className={selectClassName}
        >
          {catalog.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Cell>
      <Cell>
        <select
          aria-label={`${PHASE_LABELS[phase]} model`}
          value={model?.id ?? ""}
          onChange={(event) => {
            if (!provider) return;
            const nextModel = findModel(provider, event.target.value);
            if (!nextModel) return;
            onChange({
              ...value,
              model: nextModel.id,
              thinkingLevel: safeThinkingLevel(nextModel, value.thinkingLevel),
            });
          }}
          className={selectClassName}
        >
          {provider?.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Cell>
      <Cell>
        <select
          aria-label={`${PHASE_LABELS[phase]} thinking level`}
          value={thinkingLevels.includes(value.thinkingLevel) ? value.thinkingLevel : thinkingLevels[0]}
          onChange={(event) => {
            if (!isThinkingLevel(event.target.value)) return;
            onChange({ ...value, thinkingLevel: event.target.value });
          }}
          className={selectClassName}
        >
          {thinkingLevels.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </Cell>
    </>
  );
}

function HeaderCell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card px-3 py-2 font-mono text-[10px] uppercase tracking-[0.05em] text-fg-faint">
      {children}
    </div>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return <div className="bg-card px-2 py-2">{children}</div>;
}

function initialConfig(catalog: ModelCatalog): PhaseModels {
  return {
    brainstorm: configForPhase(catalog, "brainstorm"),
    plan: configForPhase(catalog, "plan"),
    code: configForPhase(catalog, "code"),
    verify: configForPhase(catalog, "verify"),
    pr: configForPhase(catalog, "pr"),
  };
}

function configForPhase(catalog: ModelCatalog, phase: Phase): PhaseModelConfig {
  const fallbackProvider = catalog.providers[0];
  const fallbackModel = fallbackProvider?.models[0];
  const defaultConfig = catalog.defaults[phase];
  const provider = findProvider(catalog, defaultConfig.provider) ?? fallbackProvider;
  const model = provider ? findModel(provider, defaultConfig.model) ?? provider.models[0] : fallbackModel;

  return {
    provider: provider?.id ?? defaultConfig.provider,
    model: model?.id ?? defaultConfig.model,
    thinkingLevel: model ? safeThinkingLevel(model, defaultConfig.thinkingLevel) : defaultConfig.thinkingLevel,
  };
}

function safeThinkingLevel(model: ModelCatalogModel, preferred: ThinkingLevel): ThinkingLevel {
  if (model.thinkingLevels.includes(preferred)) return preferred;
  if (model.thinkingLevels.includes("off")) return "off";
  return model.thinkingLevels[0] ?? "off";
}

function findProvider(catalog: ModelCatalog, providerId: string): ModelCatalogProvider | undefined {
  return catalog.providers.find((provider) => provider.id === providerId);
}

function findModel(provider: ModelCatalogProvider, modelId: string): ModelCatalogModel | undefined {
  return provider.models.find((model) => model.id === modelId);
}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return THINKING_LEVELS.some((level) => level === value);
}

const selectClassName =
  "h-8 w-full rounded border border-line bg-input px-2 text-[12px] text-fg-body outline-none transition-colors focus:border-st-progress";
