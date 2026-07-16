import { reachStats, workspaceMails, workspaceTrafficMails } from "./mails.mjs";

export async function reachRoutes(app, { resolveWorkspace, includeUnknownVault = false }) {
  app.get("/mails", async (request) =>
    workspaceMails(resolveWorkspace(request), { includeUnknownVault }));

  app.get("/reach/stats", async (request) =>
    reachStats(await workspaceTrafficMails(resolveWorkspace(request))));
}
