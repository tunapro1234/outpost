import { runFollowUpEngine } from "./followup.mjs";

export const DEFAULT_FOLLOWUP_INTERVAL_MS = 60 * 60 * 1000;

export class FollowUpScheduler {
  constructor(registry, {
    intervalMs = DEFAULT_FOLLOWUP_INTERVAL_MS,
    run = runFollowUpEngine,
    now = () => new Date(),
    onError = () => {},
  } = {}) {
    this.registry = registry;
    this.intervalMs = intervalMs;
    this.run = run;
    this.now = now;
    this.onError = onError;
    this.timer = null;
    this.queue = Promise.resolve();
  }

  tick() {
    const task = this.queue.then(async () => {
      const results = {};
      for (const workspace of this.registry.workspaces.values()) {
        try {
          results[workspace.id] = await this.run(workspace, { now: this.now });
        } catch (error) {
          this.onError(error, workspace);
        }
      }
      return results;
    });
    this.queue = task.catch(() => {});
    return task;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error) => this.onError(error));
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.queue;
  }
}
