import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { TYPE_DIRECTORIES, VaultIndex, serializeMarkdown } from "./lib/vault.mjs";
import { normalizeSearch } from "./lib/slug.mjs";

const SERVER_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WEB_DIST = path.resolve(SERVER_DIRECTORY, "../web/dist");
const VALID_TYPES = new Set(Object.keys(TYPE_DIRECTORIES));

function apiError(reply, status, message) {
  return reply.code(status).send({ error: message });
}

function csv(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
}

function entityListItem(entity, index) {
  return {
    id: entity.id,
    name: entity.meta.name,
    type: entity.meta.type,
    subtype: entity.meta.subtype ?? null,
    status: entity.meta.status ?? null,
    score: typeof entity.meta.score === "number" ? entity.meta.score : null,
    city: entity.meta.city ?? null,
    mail: entity.meta.mail ?? null,
    degree: index.degrees.get(entity.id) ?? 0,
  };
}

function increment(counter, value) {
  if (typeof value !== "string" || !value.trim()) return;
  counter[value] = (counter[value] ?? 0) + 1;
}

function facets(index) {
  const subtypes = Object.fromEntries(
    Object.keys(TYPE_DIRECTORIES).map((type) => [type, {}]),
  );
  const statuses = {};
  const cities = {};
  const mailSources = {};

  for (const entity of index.entities.values()) {
    increment(subtypes[entity.meta.type], entity.meta.subtype);
    increment(statuses, entity.meta.status);
    increment(cities, entity.meta.city);
    increment(mailSources, entity.meta.mail_source);
  }

  const degrees = [...index.degrees.values()].sort((left, right) => left - right);
  return {
    subtypes,
    statuses,
    cities,
    mail_sources: mailSources,
    degree: {
      max: degrees.at(-1) ?? 0,
      p99: degrees.length ? degrees[Math.ceil(degrees.length * 0.99) - 1] : 0,
    },
  };
}

function contentType(filePath) {
  const types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return types[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function serveWeb(request, reply, webDist) {
  if (request.url.startsWith("/api/") || request.url === "/api") {
    return apiError(reply, 404, "Endpoint bulunamadı");
  }
  const requestPath = decodeURIComponent(request.url.split("?", 1)[0]);
  const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  let filePath = path.resolve(webDist, relative);
  if (filePath !== webDist && !filePath.startsWith(`${webDist}${path.sep}`)) {
    return apiError(reply, 400, "Geçersiz yol");
  }
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
    const data = await fs.readFile(filePath);
    return reply.type(contentType(filePath)).send(data);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
  }
  try {
    const index = await fs.readFile(path.join(webDist, "index.html"));
    return reply.type("text/html; charset=utf-8").send(index);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return reply
      .type("text/plain; charset=utf-8")
      .send("UI build edilmemiş");
  }
}

export async function createApp({
  vaultPath = process.env.OUTPOST_VAULT ?? path.resolve(process.cwd(), "data/vault"),
  webDist = DEFAULT_WEB_DIST,
  watch = true,
  logger = false,
} = {}) {
  const app = Fastify({ logger });
  const index = await new VaultIndex(vaultPath).load();
  if (watch) await index.startWatching();
  app.decorate("vaultIndex", index);
  app.addHook("onClose", async () => index.close());
  app.setErrorHandler((error, _request, reply) => {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    return apiError(reply, status, error.message || "Sunucu hatası");
  });
  app.setNotFoundHandler((_request, reply) =>
    apiError(reply, 404, "Endpoint bulunamadı"));

  app.get("/healthz", async () => ({
    ok: true,
    vault: index.vaultPath,
    entities: index.entities.size,
  }));

  app.get("/api/graph", async (request, reply) => {
    const types = csv(request.query.types);
    const statuses = csv(request.query.statuses);
    const q = normalizeSearch(request.query.q);
    let minScore = null;
    if (request.query.minScore !== undefined) {
      minScore = Number(request.query.minScore);
      if (!Number.isFinite(minScore)) return apiError(reply, 400, "minScore sayı olmalı");
    }

    const visible = new Set();
    const nodes = [];
    for (const entity of index.entities.values()) {
      const meta = entity.meta;
      const score = typeof meta.score === "number" ? meta.score : null;
      if (types && !types.has(meta.type)) continue;
      if (statuses && !statuses.has(meta.status ?? "")) continue;
      if (minScore !== null && (score === null || score < minScore)) continue;
      if (q && !normalizeSearch(meta.name).includes(q)) continue;
      visible.add(entity.id);
      nodes.push({
        id: entity.id,
        name: meta.name,
        type: meta.type,
        subtype: meta.subtype ?? null,
        status: meta.status ?? null,
        score,
        degree: index.degrees.get(entity.id) ?? 0,
      });
    }
    return {
      nodes,
      edges: index.edges.filter(
        (edge) => visible.has(edge.source) && visible.has(edge.target),
      ),
    };
  });

  app.get("/api/entities", async (request, reply) => {
    const { type, status } = request.query;
    const q = normalizeSearch(request.query.q);
    const sort = request.query.sort ?? "score";
    const order = request.query.order ?? "desc";
    if (!["score", "name", "degree"].includes(sort)) {
      return apiError(reply, 400, "sort score, name veya degree olmalı");
    }
    if (!["asc", "desc"].includes(order)) {
      return apiError(reply, 400, "order asc veya desc olmalı");
    }
    const items = [...index.entities.values()]
      .filter((entity) => !type || entity.meta.type === type)
      .filter((entity) => status === undefined || (entity.meta.status ?? "") === status)
      .filter((entity) => !q || normalizeSearch(entity.meta.name).includes(q))
      .map((entity) => entityListItem(entity, index));

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
      return direction * (leftValue - rightValue);
    });
    return items;
  });

  app.get("/api/entities/:id", async (request, reply) => {
    const detail = index.entityDetail(request.params.id);
    if (!detail) return apiError(reply, 404, "Entity bulunamadı");
    return detail;
  });

  app.get("/api/facets", async () => facets(index));

  app.get("/api/mails", async () => {
    const mails = [];
    for (const entity of index.entities.values()) {
      if (entity.meta.type !== "person") continue;
      for (const mail of entity.mails) {
        mails.push({
          person_id: entity.id,
          person_name: entity.meta.name,
          ...mail,
        });
      }
    }
    mails.sort((left, right) => {
      if (left.date === null && right.date === null) return 0;
      if (left.date === null) return 1;
      if (right.date === null) return -1;
      return right.date.localeCompare(left.date);
    });
    return mails;
  });

  app.patch("/api/entities/:id", async (request, reply) => {
    const entity = index.entities.get(request.params.id);
    if (!entity) return apiError(reply, 404, "Entity bulunamadı");
    const payload = request.body;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return apiError(reply, 400, "JSON gövdesi nesne olmalı");
    }
    if (
      payload.meta !== undefined &&
      (!payload.meta || typeof payload.meta !== "object" || Array.isArray(payload.meta))
    ) {
      return apiError(reply, 400, "meta nesne olmalı");
    }
    if (payload.body !== undefined && typeof payload.body !== "string") {
      return apiError(reply, 400, "body metin olmalı");
    }
    const meta = { ...entity.meta };
    for (const [key, value] of Object.entries(payload.meta ?? {})) {
      if (value === null) delete meta[key];
      else meta[key] = value;
    }
    if (!VALID_TYPES.has(meta.type)) return apiError(reply, 400, "Geçerli type zorunlu");
    if (typeof meta.name !== "string" || !meta.name.trim()) {
      return apiError(reply, 400, "name zorunlu");
    }
    const body = payload.body ?? entity.body;
    let filePath = entity.filePath;
    if (meta.type !== entity.meta.type) {
      const directory = path.join(index.vaultPath, TYPE_DIRECTORIES[meta.type]);
      await fs.mkdir(directory, { recursive: true });
      filePath = path.join(directory, `${entity.id}.md`);
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
    return index.entityDetail(entity.id);
  });

  app.post("/api/entities", async (request, reply) => {
    const payload = request.body;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return apiError(reply, 400, "JSON gövdesi nesne olmalı");
    }
    if (!VALID_TYPES.has(payload.type)) return apiError(reply, 400, "Geçerli type zorunlu");
    if (typeof payload.name !== "string" || !payload.name.trim()) {
      return apiError(reply, 400, "name zorunlu");
    }
    if (
      payload.meta !== undefined &&
      (!payload.meta || typeof payload.meta !== "object" || Array.isArray(payload.meta))
    ) {
      return apiError(reply, 400, "meta nesne olmalı");
    }
    if (payload.body !== undefined && typeof payload.body !== "string") {
      return apiError(reply, 400, "body metin olmalı");
    }
    const id = index.nextId(payload.name);
    const extraMeta = { ...(payload.meta ?? {}) };
    delete extraMeta.type;
    delete extraMeta.name;
    const meta = { type: payload.type, name: payload.name, ...extraMeta };
    const directory = path.join(index.vaultPath, TYPE_DIRECTORIES[payload.type]);
    const filePath = path.join(directory, `${id}.md`);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(filePath, serializeMarkdown(payload.body ?? "", meta), {
      encoding: "utf8",
      flag: "wx",
    });
    await index.loadFile(filePath);
    return reply.code(201).send(index.entityDetail(id));
  });

  app.delete("/api/entities/:id", async (request, reply) => {
    const entity = index.entities.get(request.params.id);
    if (!entity) return apiError(reply, 404, "Entity bulunamadı");
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

  app.get("/api/stats", async () => {
    const byType = {};
    const byStatus = {};
    for (const entity of index.entities.values()) {
      const type = entity.meta.type;
      const status = entity.meta.status;
      byType[type] = (byType[type] ?? 0) + 1;
      if (status) byStatus[status] = (byStatus[status] ?? 0) + 1;
    }
    return {
      total: index.entities.size,
      byType,
      byStatus,
      edgeCount: index.edges.length,
    };
  });

  app.get("/*", async (request, reply) => serveWeb(request, reply, path.resolve(webDist)));
  return app;
}
