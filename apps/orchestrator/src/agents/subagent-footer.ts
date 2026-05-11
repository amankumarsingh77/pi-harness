// Appended to every research-subagent system prompt at session-create time.
// Counter-instructs the rpiv-mono "spawn parallel agents" idiom that those
// vendored prompts carry — under pi there's no Task tool, and the SDK tools
// allowlist already strips bash, so the model has no path to recurse.
//
// Kept in code (not in the .md files) so SDK/tooling changes don't require
// re-editing every vendored prompt.
export const SUBAGENT_FOOTER = `## Tooling reminder (harness-injected)

You have no ability to spawn other agents. Use only the tools provided to you. Do not run bash.

When you are done researching, persist your findings via the \`write_findings\` tool. It accepts a single \`body\` argument (the full markdown for your findings document) and writes to the correct path automatically — there is no path parameter to choose. Call it exactly once.`;
