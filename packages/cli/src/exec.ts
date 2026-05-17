import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CommandResult = {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
};

export type ExecFile = (
  command: string,
  args: ReadonlyArray<string>,
  options?: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

export const nodeExecFile: ExecFile = async (command, args, options) => {
  try {
    const result = await execFileAsync(command, [...args], { ...options, encoding: "utf8" });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return readExecError(error);
  }
};

function readExecError(error: unknown): CommandResult {
  if (typeof error !== "object" || error === null) {
    return { ok: false, stdout: "", stderr: String(error) };
  }
  const record = error as Record<string, unknown>;
  return {
    ok: false,
    stdout: typeof record["stdout"] === "string" ? record["stdout"] : "",
    stderr: typeof record["stderr"] === "string" ? record["stderr"] : String(error),
  };
}
