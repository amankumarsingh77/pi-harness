# Unified Provider & Model Registry

## Problem

Provider/model data is assembled independently in three places that drift:

- `buildModelCatalog()` (`pi-bridge/model-catalog.ts`) → `GET /api/model-options`
- `listAvailableProviders()` (`pi-bridge/agent-session.ts`) → `GET /api/chat/providers`
- `CROFAI_FALLBACK` (`dashboard/lib/chat/available-models.ts`) → ModelPicker when orchestrator is down

The same `getProviders()`/`getModels()` walk is duplicated with different output shapes
(`maxTokens`+`credential` vs `cost`+`authenticated`), two divergent display-name sources
(`labelForProvider` derives from id; `PROVIDER_DISPLAY_NAMES` is curated — they disagree, e.g.
"Xai" vs "xAI"), two duplicated `OAUTH_PROVIDERS` sets, two env-var notions
(`BUILT_IN_PROVIDER_ENV` vs the SDK's `findEnvKeys`), and the CrofAI model list mirrored by hand
in the dashboard. No single source of truth; ~15 consumers reach provider/model data through
divergent paths.

## Decision

One registry module in `pi-bridge` owns all provider/model definitions and is the single source
of truth. Both the catalog and session-creation credential logic derive from it. Custom providers
live in one `CUSTOM_PROVIDERS` array (append one object to add a provider). The two divergent HTTP
endpoints collapse into a single `GET /api/providers` with one clean shape. The hand-mirrored
dashboard fallback is deleted.

(User decisions: registry = one catalog fn in pi-bridge; custom providers = single array; drop the
hardcoded fallback; unify the wire contract to one endpoint.)

## Unified shape (the one public contract)

```typescript
type ProviderModel = {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number }; // USD per 1M tokens
};

type Provider = {
  id: string;
  name: string;                        // single display name (was label / name)
  authenticated: boolean;              // credential present (env key or oauth login)
  auth: "api-key" | "oauth";
  requiredEnvVars: readonly string[];  // [] for oauth; drives "set X in .env.harness" hint
  models: readonly ProviderModel[];
};
```

This is a superset of what every consumer renders. The old `credential.{kind,configured,
requiredEnvVars}` maps onto `auth` + `authenticated` + `requiredEnvVars`. The `ambient` credential
kind collapses into `auth: "api-key"` with `requiredEnvVars: []`.

## Module: `pi-bridge/src/provider-registry.ts` (new — single owner)

- `CUSTOM_PROVIDERS: readonly CustomProviderDef[]` — one array; each `{ name, envVar, config }`
  wrapping the provider config literal (CrofAI today). Adding a provider = append one object.
- `OAUTH_PROVIDERS` — defined once, exported.
- `PROVIDER_DISPLAY_NAMES` + `providerDisplayName()` — one display-name resolution.
- `listProviders(opts?): Provider[]` — the single enumeration: built-in (`getProviders`/`getModels`)
  + `CUSTOM_PROVIDERS`, authenticated-first then alphabetical sort. The one source of truth.
- Credential helpers used by session creation: `isOAuthProvider`, `customProviderEnv(id)`,
  `customProviderConfig(id)`, `isCustomProvider(id)`, `requiredEnvVarsFor(id)`.

## Edits

1. **`model-catalog.ts`** — delete `BUILT_IN_PROVIDER_ENV`, local `OAUTH_PROVIDERS`,
   `labelForProvider`, `buildCrofaiProvider`, `credentialForBuiltInProvider`. `buildModelCatalog`
   either removed (callers move to `listProviders`) or kept as a thin alias during migration.
2. **`agent-session.ts`** — delete local `CUSTOM_PROVIDER_ENV`, `OAUTH_PROVIDERS`,
   `PROVIDER_DISPLAY_NAMES`, `listAvailableProviders`'s own enumeration. `resolveModel`,
   `assertCredential`, `syncRuntimeApiKey`, `buildCustomRegistry` call registry helpers.
3. **Orchestrator HTTP** — add `GET /api/providers` → `listProviders()`. Remove
   `/api/model-options` and `/api/chat/providers` (and their route files / registrations).
4. **Dashboard** — one `Provider`/`ProviderModel` type in `lib/api`; one client method
   `getProviders()`; proxy path `/api/proxy/providers`. `StageModelSelector` and the chat
   ModelPicker path both read the unified shape. Delete `CROFAI_FALLBACK`; empty catalog → empty
   state.
5. **Tests** — migrate the two endpoint contract tests to `/api/providers`; update component
   fixtures to the unified shape; add a registry unit test asserting built-in + custom providers
   enumerate with correct auth flags and no secret leakage.

## Risk

Touches session-creation credential paths (`resolveModel`/`assertCredential`) and a public wire
contract. Mitigation: registry helpers preserve the exact credential semantics; endpoint behavior
covered by migrated contract tests; single code review at the end (per project batch-review
preference), not mid-refactor.
