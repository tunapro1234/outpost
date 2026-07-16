import { latestRun, listRuns, readRun } from "./journal.mjs";
import { GATHER_KINDS, readAgentRegistry } from "./registry.mjs";
import { decideStage, listStage, stageStats } from "./stage.mjs";

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
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

export async function gatherRoutes(app, { resolveWorkspace, runner }) {
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
