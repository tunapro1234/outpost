import { readAgentRegistry } from "./registry.mjs";

function fieldMatches(field, value, minimum, maximum) {
  return field.split(",").some((part) => {
    const stepMatch = /^(.+)\/(\d+)$/.exec(part);
    const base = stepMatch?.[1] ?? part;
    const step = stepMatch ? Number(stepMatch[2]) : 1;
    if (!Number.isInteger(step) || step < 1) return false;
    if (base === "*") return (value - minimum) % step === 0;
    const range = /^(\d+)-(\d+)$/.exec(base);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      return start >= minimum && end <= maximum && value >= start && value <= end &&
        (value - start) % step === 0;
    }
    const exact = Number(base);
    return Number.isInteger(exact) && exact >= minimum && exact <= maximum &&
      value === exact;
  });
}

export function cronMatches(expression, date = new Date()) {
  if (typeof expression !== "string") return false;
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return [
    [fields[0], date.getMinutes(), 0, 59],
    [fields[1], date.getHours(), 0, 23],
    [fields[2], date.getDate(), 1, 31],
    [fields[3], date.getMonth() + 1, 1, 12],
    [fields[4], date.getDay(), 0, 6],
  ].every(([field, value, minimum, maximum]) =>
    fieldMatches(field, value, minimum, maximum));
}

export class GatherScheduler {
  constructor(registry, runner, {
    intervalMs = 30_000,
    now = () => new Date(),
    onError = () => {},
  } = {}) {
    this.registry = registry;
    this.runner = runner;
    this.intervalMs = intervalMs;
    this.now = now;
    this.onError = onError;
    this.timer = null;
    this.triggered = new Set();
  }

  async tick() {
    const now = this.now();
    const minute = now.toISOString().slice(0, 16);
    this.triggered = new Set(
      [...this.triggered].filter((key) => key.endsWith(`\0${minute}`)),
    );
    for (const workspace of this.registry.workspaces.values()) {
      let agents;
      try {
        agents = await readAgentRegistry(workspace);
      } catch (error) {
        this.onError(error);
        continue;
      }
      for (const agent of agents) {
        if (!agent.enabled || agent.schedule === "manual") continue;
        if (!cronMatches(agent.schedule, now)) continue;
        const key = `${workspace.id}\0${agent.id}\0${minute}`;
        if (this.triggered.has(key)) continue;
        this.triggered.add(key);
        this.runner.start(workspace, agent.id)
          .then(({ promise }) => promise)
          .catch((error) => this.onError(error));
      }
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((error) => this.onError(error));
    }, this.intervalMs);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}
