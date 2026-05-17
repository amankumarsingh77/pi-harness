export class TaskMutationLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  async runExclusive<T>(taskId: string, action: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(taskId) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.catch(() => undefined).then(() => current);
    this.tails.set(taskId, tail);

    await prior.catch(() => undefined);
    try {
      return await action();
    } finally {
      release();
      if (this.tails.get(taskId) === tail) {
        this.tails.delete(taskId);
      }
    }
  }
}
