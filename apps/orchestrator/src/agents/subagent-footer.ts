export function makeSubagentFooter(
  opts: { readonly hasGitHistory?: boolean; readonly findingsMode?: "write" | "return" } = {},
): string {
  const gitHistory = opts.hasGitHistory === true
    ? `
You have the \`git_history\` tool for read-only git history. Use it instead of bash for commit logs, commit stats, and file-at-commit inspection.
`
    : "";
  const findings =
    opts.findingsMode === "return"
      ? "When complete, return your findings by calling the `return_findings` tool with a single `body` argument (the full markdown for your findings); it sends them directly back to the parent planner. This is preferred. If you instead end with your findings as your final message, that will be used. Do not write findings files."
      : "Persist your findings via the `write_findings` tool. It accepts a single `body` argument (the full markdown for your findings document) and writes to the correct path automatically — there is no path parameter to choose. Write a concise checkpoint early, then overwrite it with final findings if you learn more.";

  return `## Tooling reminder (harness-injected)

You have no ability to spawn other agents. Use only the tools provided to you. Do not run bash.
${gitHistory}
${findings}`;
}

export const SUBAGENT_FOOTER = makeSubagentFooter();
