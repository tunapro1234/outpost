import { overviewMetrics } from "./service.mjs";
import { workspaceNetworkView } from "../../lib/config.mjs";

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

export async function overviewRoutes(app, { resolveWorkspace, now }) {
  app.get("/metrics", async (request) => {
    const workspace = resolveWorkspace(request);
    const requested = request.query?.network;
    if (requested === undefined || requested === "") {
      return overviewMetrics(workspace, { ...(now ? { now } : {}) });
    }
    if (typeof requested !== "string") fail(400, "network metin olmalı");
    const network = workspace.getNetwork?.(requested);
    if (!network) fail(404, "Network bulunamadı");
    return overviewMetrics(
      workspaceNetworkView(workspace, network),
      { ...(now ? { now } : {}) },
    );
  });
}
