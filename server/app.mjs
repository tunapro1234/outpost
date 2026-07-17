import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { WorkspaceRegistry } from "./lib/config.mjs";
import { apiError, serveWeb } from "./lib/http.mjs";
import { assistantRoutes } from "./modules/assistant/routes.mjs";
import { copilotRoutes } from "./modules/copilot/routes.mjs";
import { runClaude } from "./modules/copilot/runner.mjs";
import { ControlRegistry } from "./modules/control/registry.mjs";
import { controlRoutes } from "./modules/control/routes.mjs";
import { dashboardRoutes } from "./modules/dashboard/routes.mjs";
import { gatherRoutes } from "./modules/gather/routes.mjs";
import { GatherRunner } from "./modules/gather/runner.mjs";
import { GatherScheduler } from "./modules/gather/scheduler.mjs";
import { mailRoutes } from "./modules/mail/routes.mjs";
import { mailerRoutes } from "./modules/mailer/routes.mjs";
import { FollowUpScheduler } from "./modules/mailer/scheduler.mjs";
import {
  DEFAULT_MAIL_DATA,
  DEFAULT_MAIL_INTERVAL_MS,
  MailIngestor,
} from "./modules/mail/service.mjs";
import { networkRoutes } from "./modules/network/routes.mjs";
import { overviewRoutes } from "./modules/overview/routes.mjs";
import { profileRoutes } from "./modules/profile/routes.mjs";
import { reachRoutes } from "./modules/reach/routes.mjs";

const SERVER_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WEB_DIST = path.resolve(SERVER_DIRECTORY, "../web/dist");
const DEFAULT_WORKSPACES = path.resolve(SERVER_DIRECTORY, "../data/workspaces");

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
  { legacy = false, gatherRunner, metricsNow, defaultUser } = {},
) {
  await app.register(overviewRoutes, { prefix, resolveWorkspace, now: metricsNow });
  await app.register(networkRoutes, { prefix, resolveWorkspace });
  await app.register(reachRoutes, {
    prefix,
    resolveWorkspace,
    includeUnknownVault: legacy,
  });
  await app.register(gatherRoutes, {
    prefix,
    resolveWorkspace,
    runner: gatherRunner,
    defaultUser,
  });
}

export async function createApp({
  vaultPath,
  workspacesPath = process.env.OUTPOST_WORKSPACES ?? DEFAULT_WORKSPACES,
  outpostVault = vaultPath ? undefined : process.env.OUTPOST_VAULT,
  defaultWorkspace,
  webDist = DEFAULT_WEB_DIST,
  watch = true,
  schedule = watch,
  mailSchedule = schedule,
  mailDataPath = process.env.OUTPOST_MAIL_DATA ?? DEFAULT_MAIL_DATA,
  mailIntervalMs = DEFAULT_MAIL_INTERVAL_MS,
  mailScan,
  followupSchedule = schedule,
  followupIntervalMs,
  followUpRun,
  gatherRunner = new GatherRunner(),
  copilotRunner = runClaude,
  assistantExec,
  assistantFileSystem,
  assistantSleep,
  assistantClaudeBin,
  assistantBriefTemplatePath,
  assistantSpawnWaitMs,
  assistantBridgeOptions,
  metricsNow,
  usersPath,
  htpasswdPath,
  defaultUser = process.env.OUTPOST_DEFAULT_USER,
  exampleVaultPath,
  controlRegistry,
  logger = false,
} = {}) {
  const app = Fastify({ logger });
  const registry = vaultPath
    ? await WorkspaceRegistry.fromVault(vaultPath, { watch })
    : await WorkspaceRegistry.load({
        workspacesPath,
        outpostVault,
        defaultWorkspace,
        exampleVaultPath,
        onSeed: ({ id, directory, source }) => app.log.info(
          { workspace: id, directory, source },
          "Demo workspace seeded from example-vault",
        ),
        watch,
      });

  app.decorate("workspaceRegistry", registry);
  app.decorate("vaultIndex", registry.getDefault()?.index ?? null);
  app.decorate("gatherRunner", gatherRunner);
  app.decorate("copilotRunner", copilotRunner);
  const controls = controlRegistry ?? new ControlRegistry();
  app.decorate("controlRegistry", controls);
  const gatherScheduler = new GatherScheduler(registry, gatherRunner, {
    onError: (error) => app.log.warn({ err: error }, "Gather scheduler error"),
  });
  const mailIngestor = new MailIngestor(registry, {
    mailDataPath,
    intervalMs: mailIntervalMs,
    ...(mailScan ? { scan: mailScan } : {}),
    onWarn: (error, context) => app.log.warn({ err: error }, context),
  });
  const followUpScheduler = new FollowUpScheduler(registry, {
    ...(followupIntervalMs ? { intervalMs: followupIntervalMs } : {}),
    ...(followUpRun ? { run: followUpRun } : {}),
    onError: (error, workspace) => app.log.warn(
      { err: error, workspace: workspace?.id },
      "Follow-up scheduler error",
    ),
  });
  app.decorate("mailIngestor", mailIngestor);
  app.decorate("followUpScheduler", followUpScheduler);
  if (schedule) gatherScheduler.start();
  if (followupSchedule) followUpScheduler.start();
  app.addHook("onClose", async () => {
    controls.close();
    gatherScheduler.stop();
    await followUpScheduler.stop();
    await mailIngestor.stop();
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

  await app.register(profileRoutes, {
    prefix: "/api",
    usersPath,
    htpasswdPath,
    defaultUser,
  });
  await app.register(controlRoutes, {
    prefix: "/api/control",
    defaultUser,
    registry: controls,
  });
  const resolveScopedWorkspace = scopedResolver(registry);
  await mountApi(app, "/api/ws/:ws", resolveScopedWorkspace, {
    gatherRunner,
    metricsNow,
    defaultUser,
  });
  await app.register(copilotRoutes, {
    prefix: "/api/ws/:ws",
    resolveWorkspace: resolveScopedWorkspace,
    runner: copilotRunner,
    defaultUser,
  });
  await app.register(dashboardRoutes, {
    prefix: "/api/ws/:ws",
    resolveWorkspace: resolveScopedWorkspace,
    defaultUser,
  });
  await app.register(assistantRoutes, {
    prefix: "/api/ws/:ws",
    resolveWorkspace: resolveScopedWorkspace,
    defaultUser,
    exec: assistantExec,
    fileSystem: assistantFileSystem,
    sleep: assistantSleep,
    claudeBin: assistantClaudeBin,
    briefTemplatePath: assistantBriefTemplatePath,
    spawnWaitMs: assistantSpawnWaitMs,
    bridgeOptions: assistantBridgeOptions,
    usersPath,
  });
  await app.register(mailRoutes, {
    prefix: "/api/ws/:ws",
    resolveWorkspace: resolveScopedWorkspace,
    ingestor: mailIngestor,
  });
  await app.register(mailerRoutes, {
    prefix: "/api/ws/:ws",
    resolveWorkspace: resolveScopedWorkspace,
    defaultUser,
    usersPath,
  });
  await mountApi(app, "/api", defaultResolver(registry), {
    legacy: true,
    gatherRunner,
    metricsNow,
    defaultUser,
  });

  if (mailSchedule) await mailIngestor.start();

  app.get("/*", async (request, reply) => serveWeb(request, reply, path.resolve(webDist)));
  return app;
}
