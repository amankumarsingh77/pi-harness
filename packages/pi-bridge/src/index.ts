export { __resetAuthCache } from "./auth.js";
export {
  createAgentSession,
  AuthError,
  type AgentSession,
  type AgentSessionOptions,
  type PromptUsage,
  type ThinkingLevel,
  type ToolDefinition,
  type SdkBoundary,
  type SdkBoundaryCreateOptions,
  type PiBridgeEvent,
} from "./agent-session.js";
// Re-exported so callers don't need a direct dep on @earendil-works/pi-coding-agent
// just to type the event stream. The bridge owns the integration seam.
export type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
