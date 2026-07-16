import { overviewMetrics } from "./service.mjs";

export async function overviewRoutes(app, { resolveWorkspace, now }) {
  app.get("/metrics", async (request) =>
    overviewMetrics(resolveWorkspace(request), { ...(now ? { now } : {}) }));
}
