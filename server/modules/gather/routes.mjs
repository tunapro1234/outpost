import { latestRun, listRuns, readRun } from "./journal.mjs";
import { GATHER_KINDS, readAgentRegistry, updateAgentRegistry } from "./registry.mjs";
import { validCronExpression } from "./scheduler.mjs";
import { decideStage, listStage, stageStats } from "./stage.mjs";

const AGENT_PATCH_FIELDS = new Set(["schedule", "enabled", "params"]);

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function requireUser(request, defaultUser) {
  const header = request.headers["x-remote-user"];
  if (header !== undefined) {
    if (typeof header === "string" && header.trim()) return header.trim();
    fail(401, "authentication required");
  }
  if (typeof defaultUser === "string" && defaultUser.trim()) return defaultUser.trim();
  fail(401, "authentication required");
}

function agentPatch(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail(400, "JSON gövdesi nesne olmalı");
  }
  for (const key of Object.keys(payload)) {
    if (!AGENT_PATCH_FIELDS.has(key)) fail(400, `Agent alanı güncellenemez: ${key}`);
  }
  const changes = {};
  if (payload.schedule !== undefined) {
    if (typeof payload.schedule !== "string") fail(400, "schedule metin olmalı");
    const schedule = payload.schedule.trim();
    if (schedule !== "manual" && !validCronExpression(schedule)) {
      fail(400, "schedule manual veya geçerli 5-alan cron olmalı");
    }
    changes.schedule = schedule;
  }
  if (payload.enabled !== undefined) {
    if (typeof payload.enabled !== "boolean") fail(400, "enabled bool olmalı");
    changes.enabled = payload.enabled;
  }
  if (payload.params !== undefined) {
    if (!payload.params || typeof payload.params !== "object" || Array.isArray(payload.params)) {
      fail(400, "params nesne olmalı");
    }
    if (Object.hasOwn(payload.params, "limit") &&
      (!Number.isInteger(payload.params.limit) || payload.params.limit < 1 || payload.params.limit > 20)) {
      fail(400, "params.limit 1-20 arası tamsayı olmalı");
    }
    changes.params = payload.params;
  }
  return changes;
}

function runSummary(run) {
  if (!run) return null;
  return {
    id: run.id,
    started: run.started,
    ended: run.ended,
    status: run.status,
    items_in: run.items_in,
    items_out: run.items_out,
    staged: run.staged,
    warnings: run.warnings.length,
    note: run.note,
  };
}

function runSummaryText(run) {
  if (!run) return null;
  if (["error", "fail", "failed"].includes(run.status)) {
    return run.note ? `Failed: ${run.note}` : "Run failed";
  }
  if (run.status === "running") return "Run in progress";
  if (run.note) return run.note;
  const warnings = Array.isArray(run.warnings) ? run.warnings.length : 0;
  return [
    `${run.items_out ?? 0} processed`,
    `${run.staged ?? 0} staged`,
    ...(warnings ? [`${warnings} warnings`] : []),
  ].join(" · ");
}

export async function gatherRoutes(app, { resolveWorkspace, runner, defaultUser }) {
  app.get("/gather/overview", async (request) => {
    const workspace = resolveWorkspace(request);
    const agents = await readAgentRegistry(workspace);
    const { counts, stagedByAgent } = await stageStats(workspace, GATHER_KINDS);
    return {
      agents: await Promise.all(agents.map(async (agent) => {
        const activity = runner.getActivity?.(workspace, agent.id) ?? null;
        const lastRun = await latestRun(workspace, agent.id);
        const failed = ["error", "fail", "failed"].includes(lastRun?.status);
        return {
          id: agent.id,
          name: agent.name,
          kind: agent.kind,
          ...(agent.source ? { source: agent.source } : {}),
          enabled: agent.enabled,
          status: activity ? "running" : failed ? "error" : "idle",
          currentTask: activity?.currentTask ?? null,
          lastRunAt: lastRun?.started ?? null,
          lastRunSummary: runSummaryText(lastRun),
          stagedCount: stagedByAgent.get(agent.id) ?? 0,
        };
      })),
      counts,
    };
  });

  app.get("/agents", async (request) => {
    const workspace = resolveWorkspace(request);
    const agents = await readAgentRegistry(workspace);
    return Promise.all(agents.map(async (agent) => ({
      ...agent,
      last_run: runSummary(await latestRun(workspace, agent.id)),
    })));
  });

  app.patch("/agents/:id", async (request) => {
    requireUser(request, defaultUser);
    const changes = agentPatch(request.body);
    return updateAgentRegistry(resolveWorkspace(request), request.params.id, changes);
  });

  app.post("/agents/:id/run", async (request, reply) => {
    const workspace = resolveWorkspace(request);
    const { run, promise } = await runner.start(workspace, request.params.id);
    promise.catch(() => {});
    return reply.code(202).send({ id: run.id, status: run.status });
  });

  app.get("/runs", async (request) => {
    const workspace = resolveWorkspace(request);
    if (request.query.agent !== undefined && typeof request.query.agent !== "string") {
      fail(400, "agent tek bir id olmalı");
    }
    return listRuns(workspace, { agent: request.query.agent });
  });

  app.get("/runs/:runId", async (request) => {
    const run = await readRun(resolveWorkspace(request), request.params.runId);
    if (!run) fail(404, "Run bulunamadı");
    return run;
  });

  app.get("/stage", async (request) => listStage(resolveWorkspace(request)));

  app.post("/stage/decision", async (request) => {
    const payload = request.body;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      fail(400, "JSON gövdesi nesne olmalı");
    }
    return decideStage(resolveWorkspace(request), payload);
  });
}
