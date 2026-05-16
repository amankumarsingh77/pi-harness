export function makeSubagentFooter(opts: { hasGitHistory?: boolean } = {}): string {
  const gitHistory = opts.hasGitHistory === true
    ? `
You have the \`git_history\` tool for read-only git history. Use it instead of bash for commit logs, commit stats, and file-at-commit inspection.
`
    : "";

  return `## Tooling reminder (harness-injected)

You have no ability to spawn other agents. Use only the tools provided to you. Do not run bash.
${gitHistory}
When you are done researching, persist your findings via the \`write_findings\` tool. It accepts a single \`body\` argument (the full markdown for your findings document) and writes to the correct path automatically — there is no path parameter to choose. Call it exactly once.`;
}

export const SUBAGENT_FOOTER = makeSubagentFooter();
