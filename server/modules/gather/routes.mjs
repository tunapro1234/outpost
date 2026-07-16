import { latestRun, listRuns, readRun } from "./journal.mjs";
import { readAgentRegistry } from "./registry.mjs";
import { decideStage, listStage } from "./stage.mjs";

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

export async function gatherRoutes(app, { resolveWorkspace, runner }) {
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
