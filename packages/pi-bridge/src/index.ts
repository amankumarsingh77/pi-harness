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
// The single source of truth for providers and models. Every consumer (HTTP
// catalog endpoint, chat picker, stage selector) and every credential decision
// in session creation derives from this module.
export {
  listProviders,
  CUSTOM_PROVIDERS,
  OAUTH_PROVIDERS,
  isOAuthProvider,
  isCustomProvider,
  customProviderEnv,
  customProviderConfig,
  requiredEnvVarsFor,
  apiKeyFromEnv,
  type Provider,
  type ProviderModel,
  type CustomProviderDef,
} from "./provider-registry.js";
// Re-exported so callers don't need a direct dep on @earendil-works/pi-coding-agent
// just to type the event stream. The bridge owns the integration seam.
export type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
