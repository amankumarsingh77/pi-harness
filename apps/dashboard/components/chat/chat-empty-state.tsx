"use client";

type Props = {
  readonly onPromptSelect: (prompt: string) => void;
};

const PROMPTS: { text: string; sub: string }[] = [
  {
    text: "Explain how live events reach the dashboard",
    sub: "Trace store → SSE proxy → client reducer.",
  },
  {
    text: "Find where Pi sessions are created",
    sub: "Show the bridge seam and SDK assumptions.",
  },
  {
    text: "What breaks if EventSource reconnects?",
    sub: "Duplicate, cursor, and stale-turn cases.",
  },
  {
    text: "Turn this thread into a task",
    sub: "Convert the discussion into an implementation ticket.",
  },
];

/**
 * Empty state shown when no thread is selected.
 * Kicker / title / subtitle + 4 prompt cards. (REQ-002)
 */
export function ChatEmptyState({ onPromptSelect }: Props) {
  return (
    <div
      data-testid="chat-empty-state"
      className="mx-auto max-w-[660px] px-6 pb-6 pt-16"
    >
      <p className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--color-fg-faint)]">
        repo-scoped assistant
      </p>
      <h2 className="mb-2 mt-[10px] text-[21px] font-semibold leading-tight tracking-tight text-[var(--color-fg)]">
        Ask about this codebase.
      </h2>
      <p className="max-w-[460px] text-[13px] leading-relaxed text-[var(--color-fg-mute)]">
        Reads the repo, traces flows, explains errors, and hands work off to a task when
        you&apos;re ready. Read-only by default — it never writes files from chat.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-[9px]">
        {PROMPTS.map((p) => (
          <button
            key={p.text}
            type="button"
            data-testid="prompt-card"
            onClick={() => onPromptSelect(p.text)}
            className="rounded-[9px] border border-[var(--color-line)] px-[14px] py-[13px] text-left text-[12.5px] leading-[1.4] text-[var(--color-fg-body)] transition-colors hover:border-[var(--color-line-hover)] hover:bg-[var(--color-card-hover)]"
          >
            {p.text}
            <span className="mt-1 block text-[11px] text-[var(--color-fg-faint)]">{p.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
