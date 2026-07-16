import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { WorkspaceRegistry } from "./lib/config.mjs";
import { apiError, serveWeb } from "./lib/http.mjs";
import { copilotRoutes } from "./modules/copilot/routes.mjs";
import { runClaude } from "./modules/copilot/runner.mjs";
import { gatherRoutes } from "./modules/gather/routes.mjs";
import { GatherRunner } from "./modules/gather/runner.mjs";
import { GatherScheduler } from "./modules/gather/scheduler.mjs";
import { networkRoutes } from "./modules/network/routes.mjs";
import { profileRoutes } from "./modules/profile/routes.mjs";
import { reachRoutes } from "./modules/reach/routes.mjs";

const SERVER_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WEB_DIST = path.resolve(SERVER_DIRECTORY, "../web/dist");
const DEFAULT_WORKSPACES = path.resolve(SERVER_DIRECTORY, "../../workspaces");

function scopedResolver(registry) {
  return (request) => {
    const workspace = registry.get(request.params.ws);
    if (workspace) return workspace;
    const error = new Error("Workspace bulunamadı");
    error.statusCode = 404;
    throw error;
  };
}

function defaultResolver(registry) {
  return () => {
    const workspace = registry.getDefault();
    if (workspace) return workspace;
    const error = new Error("Default workspace bulunamadı");
    error.statusCode = 404;
    throw error;
  };
}

async function mountApi(
  app,
  prefix,
  resolveWorkspace,
  { legacy = false, gatherRunner } = {},
) {
  await app.register(networkRoutes, { prefix, resolveWorkspace });
  await app.register(reachRoutes, {
    prefix,
    resolveWorkspace,
    includeUnknownVault: legacy,
  });
  await app.register(gatherRoutes, { prefix, resolveWorkspace, runner: gatherRunner });
}

export async function createApp({
  vaultPath,
  workspacesPath = process.env.OUTPOST_WORKSPACES ?? DEFAULT_WORKSPACES,
  outpostVault = vaultPath ? undefined : process.env.OUTPOST_VAULT,
  defaultWorkspace,
  webDist = DEFAULT_WEB_DIST,
  watch = true,
  schedule = watch,
  gatherRunner = new GatherRunner(),
  copilotRunner = runClaude,
  usersPath,
  htpasswdPath,
  logger = false,
} = {}) {
  const app = Fastify({ logger });
  const registry = vaultPath
    ? await WorkspaceRegistry.fromVault(vaultPath, { watch })
    : await WorkspaceRegistry.load({
        workspacesPath,
        outpostVault,
        defaultWorkspace,
        watch,
      });

  app.decorate("workspaceRegistry", registry);
  app.decorate("vaultIndex", registry.getDefault()?.index ?? null);
  app.decorate("gatherRunner", gatherRunner);
  app.decorate("copilotRunner", copilotRunner);
  const gatherScheduler = new GatherScheduler(registry, gatherRunner, {
    onError: (error) => app.log.warn({ err: error }, "Gather scheduler error"),
  });
  if (schedule) gatherScheduler.start();
  app.addHook("onClose", async () => {
    gatherScheduler.stop();
    await registry.close();
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    return apiError(reply, status, error.message || "Sunucu hatası");
  });
  app.setNotFoundHandler((_request, reply) =>
    apiError(reply, 404, "Endpoint bulunamadı"));

  app.get("/healthz", async () => {
    const workspace = registry.getDefault();
    return {
      ok: true,
      vault: workspace?.vaultPath ?? null,
      entities: workspace?.index.entities.size ?? 0,
    };
  });
  app.get("/api/workspaces", async () => registry.list());

  await app.register(profileRoutes, { prefix: "/api", usersPath, htpasswdPath });
  const resolveScopedWorkspace = scopedResolver(registry);
  await mountApi(app, "/api/ws/:ws", resolveScopedWorkspace, { gatherRunner });
  await app.register(copilotRoutes, {
    prefix: "/api/ws/:ws",
    resolveWorkspace: resolveScopedWorkspace,
    runner: copilotRunner,
  });
  await mountApi(app, "/api", defaultResolver(registry), {
    legacy: true,
    gatherRunner,
  });

  app.get("/*", async (request, reply) => serveWeb(request, reply, path.resolve(webDist)));
  return app;
}
