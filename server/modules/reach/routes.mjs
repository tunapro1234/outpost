import { workspaceMails } from "./mails.mjs";

export async function reachRoutes(app, { resolveWorkspace, includeUnknownVault = false }) {
  app.get("/mails", async (request) =>
    workspaceMails(resolveWorkspace(request), { includeUnknownVault }));
}
