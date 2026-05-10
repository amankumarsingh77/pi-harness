"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders the `research/<agent>.md` file body for a finished subagent.
// `body` is null until the agent ends — show a one-line empty state.

export function AgentFindings({ body }: { body: string | null }) {
  if (body === null) {
    return (
      <p className="font-mono text-[11.5px] text-fg-mute">
        findings appear once this agent finishes
      </p>
    );
  }
  return (
    <div className="markdown-body text-[12.5px] leading-[1.6] text-fg-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body.trim()}</ReactMarkdown>
    </div>
  );
}
