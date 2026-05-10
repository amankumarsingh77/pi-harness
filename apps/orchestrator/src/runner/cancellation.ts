// Per-task AbortController registry. The route handler aborts when a
// `user_cancel` transition lands; long-running drivers (brainstorm today)
// register a controller on entry and react to its signal by aborting their
// pi session. Drivers that don't need cooperative cancellation simply skip
// register() — the route handler still settles their Run rows.

export class CancellationRegistry {
  private byTask = new Map<string, AbortController>();

  register(taskId: string): AbortController {
    const prior = this.byTask.get(taskId);
    if (prior) prior.abort();
    const controller = new AbortController();
    this.byTask.set(taskId, controller);
    return controller;
  }

  release(taskId: string, controller: AbortController): void {
    if (this.byTask.get(taskId) === controller) {
      this.byTask.delete(taskId);
    }
  }

  abort(taskId: string): void {
    const controller = this.byTask.get(taskId);
    if (!controller) return;
    controller.abort();
    this.byTask.delete(taskId);
  }
}
