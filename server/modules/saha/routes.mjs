// Saha uçları: takım sayfasındaki anket formu ve görüşme özeti kutusu.
// Kayıtların nereye ve neden oraya yazıldığı service.mjs başında anlatılıyor.
import { workspaceNetworkView } from "../../lib/config.mjs";
import { workspaceNetworkId } from "../network/service.mjs";
import {
  appendAnketKaydi,
  listAnketKayitlari,
  listGorusmeler,
  readSorular,
  saveGorusme,
} from "./service.mjs";

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function objectBody(request) {
  const payload = request.body;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail(400, "JSON gövdesi nesne olmalı");
  }
  return payload;
}

export async function sahaRoutes(app, { resolveWorkspace: resolveBase }) {
  // Ağ seçimi network modülüyle aynı sözleşme: ?network= yoksa varsayılan ağ.
  function resolveWorkspace(request, requested = request.query?.network) {
    const workspace = resolveBase(request);
    if (requested === undefined || requested === "") return workspace;
    if (typeof requested !== "string") fail(400, "network metin olmalı");
    const network = workspace.getNetwork?.(String(requested)) ?? null;
    if (!network) fail(404, "Network bulunamadı");
    return workspaceNetworkView(workspace, network);
  }

  app.get("/anket/sorular", async () => readSorular());

  app.get("/anket/cevaplar/:takimNo", async (request) => ({
    takim_no: request.params.takimNo,
    kayitlar: await listAnketKayitlari(request.params.takimNo),
  }));

  app.post("/anket/cevaplar/:takimNo", async (request, reply) => {
    const kayit = await appendAnketKaydi(request.params.takimNo, objectBody(request));
    return reply.code(201).send(kayit);
  });

  app.get("/gorusme/:takimNo", async (request) => ({
    takim_no: request.params.takimNo,
    kayitlar: await listGorusmeler(request.params.takimNo),
  }));

  app.post("/gorusme/:takimNo", async (request, reply) => {
    const payload = objectBody(request);
    const workspace = resolveWorkspace(request, payload.network);
    const entityId = typeof payload.entity_id === "string" ? payload.entity_id.trim() : "";
    if (!entityId) fail(400, "entity_id gerekli");
    if (!workspace.index.entities.has(entityId)) fail(404, "Entity bulunamadı");
    const saved = await saveGorusme(workspace, {
      entityId,
      network: workspaceNetworkId(workspace),
      takimNo: request.params.takimNo,
      kanal: payload.kanal,
      ozet: payload.ozet,
    });
    return reply.code(201).send(saved);
  });
}
