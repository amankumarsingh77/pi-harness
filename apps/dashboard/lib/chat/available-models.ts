/**
 * available-models.ts
 *
 * Maps the orchestrator's provider catalog (`ChatProvider[]` — every provider +
 * model pi supports, built-in and custom, each flagged with whether a credential
 * is configured) into the `ProviderEntry[]` shape the ModelPicker renders.
 *
 * The catalog is fetched server-side (it reads process.env + pi-ai's catalog,
 * both Node-only) and passed into the chat pages as a prop. This file only
 * reshapes already-fetched data, so it is safe in the client bundle.
 *
 * The legacy CrofAI-only fallback is kept for when the orchestrator is
 * unreachable and the catalog comes back empty.
 *
 * REQ-040, REQ-044
 */

import type { ChatProvider } from "@/lib/api";
import type { ModelEntry, ProviderEntry } from "@/components/chat/model-picker";

function formatContext(ctx: number): string {
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(0)}M`;
  if (ctx >= 1_000) return `${Math.round(ctx / 1_000)}k`;
  return String(ctx);
}

function formatCost(usdPerM: number): string {
  return `$${usdPerM.toFixed(2)}`;
}

/** Reshape one catalog model into the picker's ModelEntry. */
function toModelEntry(m: ChatProvider["models"][number]): ModelEntry {
  return {
    id: m.id,
    name: m.name,
    contextWindow: formatContext(m.contextWindow),
    costIn: formatCost(m.cost.input),
    costOut: formatCost(m.cost.output),
    reasoning: m.reasoning,
  };
}

/**
 * Map the orchestrator catalog into ProviderEntry[]. Providers with no models
 * are dropped (nothing selectable). Order is preserved (the orchestrator already
 * sorts authenticated-first, then alphabetical).
 */
export function toProviderEntries(providers: readonly ChatProvider[]): ProviderEntry[] {
  return providers
    .filter((p) => p.models.length > 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      authenticated: p.authenticated,
      models: p.models.map(toModelEntry),
    }));
}

// ── Fallback (orchestrator unreachable) ─────────────────────────────────────────
// Mirrors CROFAI_PROVIDER_CONFIG in pi-bridge/src/providers/crofai.ts so the
// picker still shows the default provider's models when the live catalog is
// empty. Update alongside that file.

const CROFAI_FALLBACK: ProviderEntry = {
  id: "crofai",
  name: "CrofAI",
  authenticated: false,
  models: [
    { id: "kimi-k2.6", name: "MoonshotAI: Kimi K2.6", contextWindow: "262k", costIn: "$0.50", costOut: "$1.99", reasoning: true },
    { id: "deepseek-v3.2", name: "DeepSeek: DeepSeek V3.2", contextWindow: "164k", costIn: "$0.28", costOut: "$0.38", reasoning: false },
    { id: "deepseek-v4-pro", name: "DeepSeek: DeepSeek V4 Pro", contextWindow: "1M", costIn: "$0.40", costOut: "$0.85", reasoning: true },
    { id: "glm-4.7", name: "Z.AI: GLM 4.7", contextWindow: "203k", costIn: "$0.25", costOut: "$1.10", reasoning: false },
  ],
};

/**
 * Build the ProviderEntry[] for the ModelPicker from the fetched catalog,
 * falling back to the CrofAI-only list when the catalog is empty.
 */
export function buildProviderEntries(providers: readonly ChatProvider[]): ProviderEntry[] {
  const entries = toProviderEntries(providers);
  return entries.length > 0 ? entries : [CROFAI_FALLBACK];
}
