/**
 * available-models.ts
 *
 * Maps the orchestrator's provider catalog (`Provider[]` — every provider +
 * model pi supports, built-in and custom, each flagged with whether a credential
 * is configured) into the `ProviderEntry[]` shape the ModelPicker renders.
 *
 * The catalog is fetched server-side (it reads process.env + pi-ai's catalog,
 * both Node-only) and passed into the chat pages as a prop. This file only
 * reshapes already-fetched data, so it is safe in the client bundle.
 *
 * When the catalog is empty (orchestrator unreachable), the picker renders an
 * empty state — there is no hand-mirrored fallback list, so what the picker
 * shows can never drift from the real catalog. (REQ-040, REQ-044)
 */

import type { Provider } from "@/lib/api";
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
function toModelEntry(m: Provider["models"][number]): ModelEntry {
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
export function toProviderEntries(providers: readonly Provider[]): ProviderEntry[] {
  return providers
    .filter((p) => p.models.length > 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      authenticated: p.authenticated,
      models: p.models.map(toModelEntry),
    }));
}

/**
 * Build the ProviderEntry[] for the ModelPicker from the fetched catalog. An
 * empty catalog yields an empty list; the picker handles the empty state.
 */
export function buildProviderEntries(providers: readonly Provider[]): ProviderEntry[] {
  return toProviderEntries(providers);
}
