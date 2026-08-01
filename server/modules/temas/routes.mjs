import { workspaceNetworkView } from "../../lib/config.mjs";
import {
  TEMAS_NETWORK,
  getTemasDurumu,
  patchTemasDurumu,
} from "./service.mjs";

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function hedefWorkspace(workspace) {
  const network = workspace.getNetwork?.(TEMAS_NETWORK) ?? null;
  if (!network) fail(404, "Hedef network bulunamadı");
  return workspaceNetworkView(workspace, network);
}

function entityInHedef(workspace, entityId) {
  const hedef = hedefWorkspace(workspace);
  if (!hedef.index.entities.has(entityId)) fail(404, "Entity bulunamadı");
  return hedef;
}

export async function temasRoutes(app, { resolveWorkspace }) {
  app.get("/temas/:entityId", async (request) => {
    const workspace = entityInHedef(
      resolveWorkspace(request),
      request.params.entityId,
    );
    return getTemasDurumu(workspace, request.params.entityId);
  });

  app.patch("/temas/:entityId", async (request) => {
    const workspace = entityInHedef(
      resolveWorkspace(request),
      request.params.entityId,
    );
    const payload = request.body;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      fail(400, "JSON gövdesi nesne olmalı");
    }
    if (Object.keys(payload).some((key) => key !== "durum")) {
      fail(400, "PATCH yalnızca durum alanını kabul eder");
    }
    return patchTemasDurumu(workspace, request.params.entityId, payload.durum);
  });
}
