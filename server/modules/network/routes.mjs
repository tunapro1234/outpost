import { promises as fs } from "node:fs";
import path from "node:path";
import {
  TYPE_DIRECTORIES,
  assertSafeVaultPath,
  assertVaultWritable,
  serializeMarkdown,
} from "../../lib/vault.mjs";
import { openWorkspaceDb } from "../../lib/db.mjs";
import { normalizeSearch, slugify } from "../../lib/slug.mjs";
import { workspaceNetworkView } from "../../lib/config.mjs";
import { mailStats, workspaceTrafficMails } from "../reach/mails.mjs";
import {
  VALID_TYPES,
  entityStateMap,
  entityListItem,
  facets,
  graph,
  networkStats,
  workspaceNetworkId,
} from "./service.mjs";

const CHANNELS = new Set(["whatsapp", "mail", "telefon", "yuzyuze", "diger"]);
const DIRECTIONS = new Set(["out", "in"]);
const RESEARCH_STATUSES = new Set(["none", "active", "done"]);

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

async function payloadContext(workspace) {
  const mails = await workspaceTrafficMails(workspace);
  return {
    statsByEntity: mailStats(mails),
    stateByEntity: entityStateMap(workspace, mails),
  };
}

function objectBody(request) {
  const payload = request.body;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail(400, "JSON gövdesi nesne olmalı");
  }
  return payload;
}

function optionalText(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string") fail(400, `${field} metin olmalı`);
  const result = value.trim();
  if (!result) fail(400, `${field} boş olmamalı`);
  return result;
}

function timestamp(value, field, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value.trim()) fail(400, `${field} geçerli tarih olmalı`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail(400, `${field} geçerli tarih olmalı`);
  return date.toISOString();
}

function selectedNetwork(workspace) {
  return workspace.network ?? workspace.defaultNetwork;
}

function assertEntity(workspace, id) {
  const entity = workspace.index.entities.get(id);
  if (!entity) fail(404, "Entity bulunamadı");
  return entity;
}

function interactionRow(row) {
  return {
    id: Number(row.id),
    workspace: row.workspace,
    network: row.network,
    entity_id: row.entity_id,
    channel: row.channel,
    direction: row.direction,
    at: row.at,
    note: row.note,
    source: row.source,
    created_at: row.created_at,
  };
}

export async function networkRoutes(app, { resolveWorkspace: resolveBase }) {
  /**
   * `?network=<id>` picks one of the workspace's networks. Without it every
   * endpoint answers from the workspace's default network exactly as before,
   * so existing callers (and the legacy `/api/...` alias) keep working.
   */
  function resolveWorkspace(request, requested = request.query?.network) {
    const workspace = resolveBase(request);
    if (requested === undefined || requested === "") return workspace;
    if (typeof requested !== "string") fail(400, "network metin olmalı");
    const network = workspace.getNetwork?.(String(requested)) ?? null;
    if (!network) fail(404, "Network bulunamadı");
    return workspaceNetworkView(workspace, network);
  }

  app.get("/networks", async (request) => resolveBase(request).listNetworks?.() ?? []);

  app.get("/graph", async (request) => {
    const workspace = resolveWorkspace(request);
    const context = await payloadContext(workspace);
    return graph(workspace.index, context.statsByEntity, request.query, {
      stateByEntity: context.stateByEntity,
      hiddenNodes: selectedNetwork(workspace)?.hiddenNodes,
    });
  });

  app.get("/entities", async (request) => {
    const workspace = resolveWorkspace(request);
    const index = workspace.index;
    const { statsByEntity, stateByEntity } = await payloadContext(workspace);
    const { type, status } = request.query;
    const q = normalizeSearch(request.query.q);
    const sort = request.query.sort ?? "score";
    const order = request.query.order ?? "desc";
    if (!["score", "name", "degree", "mail_count", "last_mail_date"].includes(sort)) {
      fail(400, "sort score, name, degree, mail_count veya last_mail_date olmalı");
    }
    if (!["asc", "desc"].includes(order)) fail(400, "order asc veya desc olmalı");

    const items = [...index.entities.values()]
      .filter((entity) => !type || entity.meta.type === type)
      .filter((entity) => status === undefined || (entity.meta.status ?? "") === status)
      .filter((entity) => !q || normalizeSearch(entity.meta.name).includes(q))
      .map((entity) => entityListItem(entity, index, statsByEntity, stateByEntity));

    const direction = order === "desc" ? -1 : 1;
    items.sort((left, right) => {
      if (sort === "name") {
        return direction * left.name.localeCompare(right.name, "tr", { sensitivity: "base" });
      }
      const leftValue = left[sort];
      const rightValue = right[sort];
      if (leftValue === null && rightValue === null) return 0;
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      if (sort === "last_mail_date") {
        return direction * String(leftValue).localeCompare(String(rightValue));
      }
      return direction * (leftValue - rightValue);
    });
    return items;
  });

  app.get("/entities/:id", async (request) => {
    const workspace = resolveWorkspace(request);
    const detail = workspace.index.entityDetail(request.params.id);
    if (!detail) fail(404, "Entity bulunamadı");
    return {
      ...detail,
      ...(await payloadContext(workspace)).stateByEntity.get(detail.id),
    };
  });

  app.get("/facets", async (request) => facets(resolveWorkspace(request).index));

  app.get("/entity/:id/interactions", async (request) => {
    const workspace = resolveWorkspace(request);
    assertEntity(workspace, request.params.id);
    const rows = openWorkspaceDb(workspace).prepare(
      `SELECT * FROM interaction
       WHERE workspace = ? AND network = ? AND entity_id = ?
       ORDER BY at DESC, id DESC`,
    ).all(workspace.id, workspaceNetworkId(workspace), request.params.id);
    return rows.map(interactionRow);
  });

  app.post("/entity/:id/interactions", async (request, reply) => {
    const payload = objectBody(request);
    const workspace = resolveWorkspace(request, payload.network);
    assertEntity(workspace, request.params.id);
    if (!CHANNELS.has(payload.channel)) {
      fail(400, "channel whatsapp, mail, telefon, yuzyuze veya diger olmalı");
    }
    const direction = payload.direction ?? "out";
    if (!DIRECTIONS.has(direction)) fail(400, "direction out veya in olmalı");
    if (payload.note !== undefined && payload.note !== null && typeof payload.note !== "string") {
      fail(400, "note metin olmalı");
    }
    const now = new Date().toISOString();
    const at = timestamp(payload.at, "at", now);
    const header = request.headers["x-remote-user"];
    const source = typeof header === "string" && header.trim() ? header.trim() : "api";
    const db = openWorkspaceDb(workspace);
    const result = db.prepare(
      `INSERT INTO interaction
       (workspace, network, entity_id, channel, direction, at, note, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      workspace.id,
      workspaceNetworkId(workspace),
      request.params.id,
      payload.channel,
      direction,
      at,
      payload.note ?? null,
      source,
      now,
    );
    const row = db.prepare("SELECT * FROM interaction WHERE id = ?")
      .get(Number(result.lastInsertRowid));
    return reply.code(201).send(interactionRow(row));
  });

  app.delete("/entity/:id/interactions/:iid", async (request) => {
    const workspace = resolveWorkspace(request);
    assertEntity(workspace, request.params.id);
    if (!/^[1-9]\d*$/.test(request.params.iid)) fail(400, "interaction id geçersiz");
    const result = openWorkspaceDb(workspace).prepare(
      `DELETE FROM interaction
       WHERE id = ? AND workspace = ? AND network = ? AND entity_id = ?`,
    ).run(
      Number(request.params.iid),
      workspace.id,
      workspaceNetworkId(workspace),
      request.params.id,
    );
    if (!result.changes) fail(404, "Interaction bulunamadı");
    return { ok: true };
  });

  app.put("/entity/:id/status", async (request) => {
    const payload = objectBody(request);
    const workspace = resolveWorkspace(request, payload.network);
    assertEntity(workspace, request.params.id);
    if (
      payload.outreach_state !== undefined &&
      (!Number.isInteger(payload.outreach_state) ||
        payload.outreach_state < 0 ||
        payload.outreach_state > 5)
    ) {
      fail(400, "outreach_state 0-5 arası tamsayı olmalı");
    }
    if (
      payload.research_status !== undefined &&
      !RESEARCH_STATUSES.has(payload.research_status)
    ) {
      fail(400, "research_status none, active veya done olmalı");
    }
    if (
      payload.agent !== undefined &&
      payload.agent !== null &&
      (typeof payload.agent !== "string" || !payload.agent.trim())
    ) {
      fail(400, "agent metin veya null olmalı");
    }
    if (
      payload.outreach_state === undefined &&
      payload.research_status === undefined &&
      payload.agent === undefined
    ) {
      fail(400, "Güncellenecek status alanı yok");
    }

    const db = openWorkspaceDb(workspace);
    const network = workspaceNetworkId(workspace);
    const existing = db.prepare(
      `SELECT * FROM entity_status
       WHERE workspace = ? AND network = ? AND entity_id = ?`,
    ).get(workspace.id, network, request.params.id);
    const outreachState = payload.outreach_state ?? existing?.outreach_state ?? null;
    const stateSource = payload.outreach_state === undefined
      ? existing?.state_source ?? null
      : "manual";
    const researchStatus =
      payload.research_status ?? existing?.research_status ?? "none";
    const researchAgent = payload.agent === undefined
      ? existing?.research_agent ?? null
      : payload.agent === null ? null : payload.agent.trim();
    const updatedAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO entity_status
       (workspace, network, entity_id, outreach_state, state_source,
        research_status, research_agent, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace, network, entity_id) DO UPDATE SET
         outreach_state = excluded.outreach_state,
         state_source = excluded.state_source,
         research_status = excluded.research_status,
         research_agent = excluded.research_agent,
         updated_at = excluded.updated_at`,
    ).run(
      workspace.id,
      network,
      request.params.id,
      outreachState,
      stateSource,
      researchStatus,
      researchAgent,
      updatedAt,
    );
    const state = entityStateMap(
      workspace,
      await workspaceTrafficMails(workspace),
    ).get(request.params.id);
    return {
      entity_id: request.params.id,
      ...state,
      agent: researchAgent,
      updated_at: updatedAt,
    };
  });

  app.get("/status-map", async (request) => {
    const workspace = resolveWorkspace(request);
    return Object.fromEntries(
      [...entityStateMap(workspace, await workspaceTrafficMails(workspace))]
        .map(([entityId, state]) => [entityId, {
          state: state.state,
          state_source: state.state_source,
          research_status: state.research_status,
        }]),
    );
  });

  app.patch("/entities/:id", async (request) => {
    const index = resolveWorkspace(request).index;
    // Yerinde bağlanmış, bize ait olmayan vault'lara yazma yok.
    assertVaultWritable(index.vaultPath);
    const entity = index.entities.get(request.params.id);
    if (!entity) fail(404, "Entity bulunamadı");
    const payload = request.body;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      fail(400, "JSON gövdesi nesne olmalı");
    }
    if (
      payload.meta !== undefined &&
      (!payload.meta || typeof payload.meta !== "object" || Array.isArray(payload.meta))
    ) {
      fail(400, "meta nesne olmalı");
    }
    if (payload.body !== undefined && typeof payload.body !== "string") {
      fail(400, "body metin olmalı");
    }

    const meta = { ...entity.meta };
    for (const [key, value] of Object.entries(payload.meta ?? {})) {
      if (value === null) delete meta[key];
      else meta[key] = value;
    }
    if (!VALID_TYPES.has(meta.type)) fail(400, "Geçerli type zorunlu");
    if (typeof meta.name !== "string" || !meta.name.trim()) fail(400, "name zorunlu");

    const body = payload.body ?? entity.body;
    let filePath = entity.filePath;
    await assertSafeVaultPath(index.vaultPath, entity.filePath);
    if (meta.type !== entity.meta.type) {
      const directory = path.join(index.vaultPath, TYPE_DIRECTORIES[meta.type]);
      await fs.mkdir(directory, { recursive: true });
      filePath = path.join(directory, `${entity.id}.md`);
      await assertSafeVaultPath(index.vaultPath, filePath, { allowMissing: true });
      await fs.writeFile(filePath, serializeMarkdown(body, meta), {
        encoding: "utf8",
        flag: "wx",
      });
      await fs.unlink(entity.filePath);
      index.removeFile(entity.filePath);
    } else {
      await fs.writeFile(filePath, serializeMarkdown(body, meta), "utf8");
    }
    await index.loadFile(filePath);
    const detail = index.entityDetail(entity.id);
    return {
      ...detail,
      ...(await payloadContext(resolveWorkspace(request))).stateByEntity.get(entity.id),
    };
  });

  app.post("/entities", async (request, reply) => {
    const index = resolveWorkspace(request).index;
    // Yerinde bağlanmış, bize ait olmayan vault'lara yazma yok.
    assertVaultWritable(index.vaultPath);
    const payload = request.body;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      fail(400, "JSON gövdesi nesne olmalı");
    }
    if (!VALID_TYPES.has(payload.type)) fail(400, "Geçerli type zorunlu");
    if (typeof payload.name !== "string" || !payload.name.trim()) fail(400, "name zorunlu");
    if (
      payload.meta !== undefined &&
      (!payload.meta || typeof payload.meta !== "object" || Array.isArray(payload.meta))
    ) {
      fail(400, "meta nesne olmalı");
    }
    if (payload.body !== undefined && typeof payload.body !== "string") {
      fail(400, "body metin olmalı");
    }

    const extraMeta = { ...(payload.meta ?? {}) };
    delete extraMeta.type;
    delete extraMeta.name;
    const meta = { type: payload.type, name: payload.name, ...extraMeta };
    const directory = path.join(index.vaultPath, TYPE_DIRECTORIES[payload.type]);
    await fs.mkdir(directory, { recursive: true });
    const initialId = index.nextId(payload.name);
    const base = slugify(payload.name) || "entity";
    let suffix = initialId === base ? 2 : Number(initialId.slice(base.length + 1)) + 1;
    let id = initialId;
    let filePath;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      filePath = path.join(directory, `${id}.md`);
      await assertSafeVaultPath(index.vaultPath, filePath, { allowMissing: true });
      try {
        await fs.writeFile(filePath, serializeMarkdown(payload.body ?? "", meta), {
          encoding: "utf8",
          flag: "wx",
        });
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (attempt === 4) fail(409, "Entity adı eşzamanlı oluşturma nedeniyle çakıştı");
        do {
          id = `${base}-${suffix}`;
          suffix += 1;
        } while (index.entities.has(id));
      }
    }
    await index.loadFile(filePath);
    const detail = index.entityDetail(id);
    return reply.code(201).send({
      ...detail,
      ...(await payloadContext(resolveWorkspace(request))).stateByEntity.get(id),
    });
  });

  app.delete("/entities/:id", async (request, reply) => {
    const index = resolveWorkspace(request).index;
    // Yerinde bağlanmış, bize ait olmayan vault'lara yazma yok.
    assertVaultWritable(index.vaultPath);
    const entity = index.entities.get(request.params.id);
    if (!entity) fail(404, "Entity bulunamadı");
    const trash = path.join(index.vaultPath, ".trash");
    await fs.mkdir(trash, { recursive: true });
    let destination = path.join(trash, `${entity.id}.md`);
    let suffix = 2;
    while (true) {
      try {
        await fs.access(destination);
      } catch (error) {
        if (error.code === "ENOENT") break;
        throw error;
      }
      destination = path.join(trash, `${entity.id}-${suffix}.md`);
      suffix += 1;
    }
    await fs.rename(entity.filePath, destination);
    index.removeFile(entity.filePath);
    return reply.send({ ok: true });
  });

  app.get("/stats", async (request) => networkStats(resolveWorkspace(request).index));
}
