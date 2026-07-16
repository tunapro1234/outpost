import { promises as fs } from "node:fs";
import path from "node:path";
import { TYPE_DIRECTORIES, serializeMarkdown } from "../../lib/vault.mjs";
import { normalizeSearch } from "../../lib/slug.mjs";
import { mailStats, workspaceTrafficMails } from "../reach/mails.mjs";
import {
  VALID_TYPES,
  entityListItem,
  facets,
  graph,
  networkStats,
} from "./service.mjs";

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

async function statsFor(workspace) {
  return mailStats(await workspaceTrafficMails(workspace));
}

export async function networkRoutes(app, { resolveWorkspace }) {
  app.get("/graph", async (request) => {
    const workspace = resolveWorkspace(request);
    return graph(workspace.index, await statsFor(workspace), request.query);
  });

  app.get("/entities", async (request) => {
    const workspace = resolveWorkspace(request);
    const index = workspace.index;
    const statsByEntity = await statsFor(workspace);
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
      .map((entity) => entityListItem(entity, index, statsByEntity));

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
    const detail = resolveWorkspace(request).index.entityDetail(request.params.id);
    if (!detail) fail(404, "Entity bulunamadı");
    return detail;
  });

  app.get("/facets", async (request) => facets(resolveWorkspace(request).index));

  app.patch("/entities/:id", async (request) => {
    const index = resolveWorkspace(request).index;
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

  app.post("/entities", async (request, reply) => {
    const index = resolveWorkspace(request).index;
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

  app.delete("/entities/:id", async (request, reply) => {
    const index = resolveWorkspace(request).index;
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
