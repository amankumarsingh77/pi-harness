import { spawn } from "node:child_process";
import { resolveAgentPath } from "@pi-harness/subagents";
import type { PiSubagentSpec, PiSubagentResult } from "./types.js";

// One-shot subagent runner. Shells out to the `pi` CLI with the agent's prompt
// file and streams JSON events back. We use the CLI rather than the SDK here
// because pi-subagents is implemented as a pi extension and the CLI path is the
// stable contract; the SDK path would require re-implementing extension loading.
export async function runSubagent(spec: PiSubagentSpec): Promise<PiSubagentResult> {
  const piPath = process.env.PI_AGENT_PATH ?? "pi";
  const promptFile = resolveAgentPath(spec.agent);

  const args = [
    "--mode",
    "json",
    "--cwd",
    spec.cwd,
    "--prompt-file",
    promptFile,
    "--",
    spec.task,
  ];

  return await new Promise<PiSubagentResult>((resolveResult) => {
    const child = spawn(piPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      // Best-effort parse of JSONL cost events; ignore parse failures.
      for (const line of chunk.toString().split("\n")) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line) as { kind?: string; usage?: Record<string, number> };
          if (evt.kind === "usage" && evt.usage) {
            costUsd += evt.usage.cost_usd ?? 0;
            inputTokens += evt.usage.input_tokens ?? 0;
            outputTokens += evt.usage.output_tokens ?? 0;
          }
        } catch {
          // not json — ignore
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });

    if (spec.signal) {
      spec.signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
    }

    child.on("close", (code) => {
      const result: PiSubagentResult = {
        ok: code === 0,
        output: out,
        inputTokens,
        outputTokens,
        costUsd,
      };
      if (code !== 0) result.error = err || `exit ${code}`;
      resolveResult(result);
    });
  });
}
