// Builds a tight per-ticket digest inlined into every research-subagent
// prompt. Replaces the prior approach of inlining full design.md + spec.md
// (~5-10KB) into each of 5 parallel subagent prompts. Subagents that need
// the full docs read them on demand from disk.
//
// Section headings are the ones the brainstorm system prompt instructs the
// agent to emit (subagents/prompts/phase/brainstorm.md). If a section is missing the
// digest degrades gracefully — falls back to the raw ticket title +
// description, never throws.

export type DigestInput = {
  ticketTitle: string;
  ticketDescription: string;
  designBody: string;
  specBody: string;
};

const DESIGN_GOALS_HEADING = "## Goals";
const SPEC_AC_HEADING = "## Acceptance criteria";
const SECTION_BODY_CHAR_CAP = 1500;

export function buildTicketDigest(input: DigestInput): string {
  const goals = extractSection(input.designBody, DESIGN_GOALS_HEADING);
  const ac = extractSection(input.specBody, SPEC_AC_HEADING);

  const parts: string[] = [];
  parts.push(`# Ticket`);
  parts.push(``);
  parts.push(`## ${input.ticketTitle}`);
  parts.push(``);
  parts.push(input.ticketDescription.trim());

  if (goals) {
    parts.push(``);
    parts.push(`# Goals (from design.md)`);
    parts.push(``);
    parts.push(truncate(goals));
  }

  if (ac) {
    parts.push(``);
    parts.push(`# Acceptance criteria (from spec.md)`);
    parts.push(``);
    parts.push(truncate(ac));
  }

  parts.push(``);
  parts.push(`# Full context (read on demand)`);
  parts.push(``);
  parts.push(`The full brainstorm artifacts are on disk in this worktree. Read them only if your job needs more than the digest above:`);
  parts.push(`- \`.harness/<task>/design.md\` — architecture decisions, trade-offs, alternatives`);
  parts.push(`- \`.harness/<task>/spec.md\` — full requirements + verification scenarios`);

  return parts.join("\n");
}

// Returns the body of the named H2 section (everything after the heading line
// up to the next H2 or EOF), trimmed. Returns null when the heading is absent
// or the section is empty.
function extractSection(body: string, heading: string): string | null {
  const lines = body.split("\n");
  const idx = lines.findIndex((l) => l.trim() === heading);
  if (idx === -1) return null;
  const collected: string[] = [];
  for (let i = idx + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.startsWith("## ")) break;
    collected.push(line);
  }
  const trimmed = collected.join("\n").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function truncate(s: string): string {
  if (s.length <= SECTION_BODY_CHAR_CAP) return s;
  return `${s.slice(0, SECTION_BODY_CHAR_CAP).trimEnd()}\n\n…(truncated for digest; read full doc on disk)`;
}
