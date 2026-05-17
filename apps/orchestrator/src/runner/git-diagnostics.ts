export type GitDiagnosticContext = {
  readonly taskId: string;
  readonly operation: string;
};

export async function withGitLockDiagnostic<T>(
  context: GitDiagnosticContext,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw enrichGitLockError(error, context);
  }
}

function enrichGitLockError(error: unknown, context: GitDiagnosticContext): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("index.lock")) return error;

  const lockPath = /'([^']*index\.lock)'/.exec(message)?.[1];
  const pathText = lockPath ? ` at ${lockPath}` : "";
  return new Error(
    `Git index lock blocked ${context.operation} for task ${context.taskId}${pathText}. ` +
      "Another git operation is still active or a previous operation crashed. " +
      `Original error: ${message}`,
  );
}
