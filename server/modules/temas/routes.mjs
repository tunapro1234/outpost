import { workspaceNetworkView } from "../../lib/config.mjs";
import {
  TEMAS_NETWORK,
  getTemasDurumu,
  listTemasDurumu,
  patchTemasDurumu,
} from "./service.mjs";

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

// Temas defteri artık `hedef`e kilitli DEĞİL: FTC hiyerarşisinde takımlara elle
// WhatsApp yazılıyor ve o kayıtlar `ftc` ağında. Ağ adı ?network= ile gelir,
// boşsa eski davranış (hedef) sürer — mevcut çağıranlar etkilenmez.
function requestNetwork(request) {
  const raw = request.query?.network;
  if (raw === undefined) return TEMAS_NETWORK;
  if (typeof raw !== "string" || !raw.trim()) fail(400, "network boş olamaz");
  return raw.trim();
}

function networkWorkspace(workspace, networkId) {
  const network = workspace.getNetwork?.(networkId) ?? null;
  if (!network) fail(404, "Network bulunamadı");
  return workspaceNetworkView(workspace, network);
}

function entityInNetwork(workspace, networkId, entityId) {
  const view = networkWorkspace(workspace, networkId);
  if (!view.index.entities.has(entityId)) fail(404, "Entity bulunamadı");
  return view;
}

export async function temasRoutes(app, { resolveWorkspace }) {
  // Ağın TÜM durumları tek çağrıda. Hiyerarşi görünümü 50+ kökü açılışta
  // boyamak zorunda; kayıt başına GET atmak olmaz.
  app.get("/temas", async (request) => {
    const networkId = requestNetwork(request);
    const workspace = networkWorkspace(resolveWorkspace(request), networkId);
    return { network: networkId, kayitlar: listTemasDurumu(workspace, networkId) };
  });

  app.get("/temas/:entityId", async (request) => {
    const networkId = requestNetwork(request);
    const workspace = entityInNetwork(
      resolveWorkspace(request),
      networkId,
      request.params.entityId,
    );
    return getTemasDurumu(workspace, request.params.entityId, networkId);
  });

  app.patch("/temas/:entityId", async (request) => {
    const networkId = requestNetwork(request);
    const workspace = entityInNetwork(
      resolveWorkspace(request),
      networkId,
      request.params.entityId,
    );
    const payload = request.body;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      fail(400, "JSON gövdesi nesne olmalı");
    }
    if (Object.keys(payload).some((key) => key !== "durum")) {
      fail(400, "PATCH yalnızca durum alanını kabul eder");
    }
    return patchTemasDurumu(workspace, request.params.entityId, payload.durum, {
      network: networkId,
    });
  });
}
