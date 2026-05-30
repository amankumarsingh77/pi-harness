export { __resetAuthCache, loadEnvHarness } from "./auth.js";
export {
  createAgentSession,
  AuthError,
  __resetRegistryCache,
  type AgentSession,
  type AgentSessionOptions,
  type PromptUsage,
  type ThinkingLevel,
  type ToolDefinition,
  type SdkBoundary,
  type SdkBoundaryCreateOptions,
  type PiBridgeEvent,
} from "./agent-session.js";
export {
  CROFAI_API_KEY_ENV,
  CROFAI_BASE_URL,
  CROFAI_PROVIDER_CONFIG,
  CROFAI_PROVIDER_NAME,
} from "./providers/crofai.js";
export {
  buildModelCatalog,
  type ModelCatalog,
  type ModelCatalogCredential,
  type ModelCatalogModel,
  type ModelCatalogProvider,
} from "./model-catalog.js";
// Re-exported so callers don't need a direct dep on @earendil-works/pi-coding-agent
// just to type the event stream. The bridge owns the integration seam.
export type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
