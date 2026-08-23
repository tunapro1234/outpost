import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ControlRegistry } from "./registry.mjs";

// Geçerli aksiyonların TEK kaynağı. Test bu kümeyi içeri alıp kendi listesini
// buradan türetir — elle tutulan ikinci bir kopya, eklenen aksiyonun test
// güncellemesini unutturuyordu (reload/set-sidebar vakası, 21→23 Ağu 2026).
export const ACTIONS = new Set([
  "navigate",
  "open-entity",
  "set-workspace",
  "set-theme",
  "set-network",
  "set-view",
  "set-filters",
  "set-color-mode",
  "set-sidebar",
  "reload",
  "toast",
]);
const LOCAL_BASE = "http://localhost";
const PAGE_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function nonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(400, `${field} must be a non-empty string`);
  }
  return value;
}

function filterString(value, field) {
  if (typeof value !== "string") fail(400, `${field} must be a string`);
  return value;
}

export function controlUser(request, defaultUser) {
  const header = request.headers["x-remote-user"];
  if (header !== undefined) {
    if (typeof header === "string" && header.trim() !== "") return header.trim();
    fail(401, "authentication required");
  }
  if (typeof defaultUser === "string" && defaultUser.trim() !== "") {
    return defaultUser.trim();
  }
  fail(401, "authentication required");
}

export function isLocalAddress(address) {
  if (typeof address !== "string") return false;
  const normalized = address.toLowerCase().split("%", 1)[0];
  if (normalized === "::1") return true;
  const ipv4 = normalized.startsWith("::ffff:")
    ? normalized.slice("::ffff:".length)
    : normalized;
  return /^127(?:\.\d{1,3}){3}$/.test(ipv4) &&
    ipv4.split(".").slice(1).every((part) => Number(part) <= 255);
}

export function isInternalPath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
    return false;
  }
  try {
    return new URL(path, LOCAL_BASE).origin === LOCAL_BASE;
  } catch {
    return false;
  }
}

export function validateCommand(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail(400, "JSON body must be an object");
  }
  if (!ACTIONS.has(payload.action)) fail(400, "unsupported control action");

  switch (payload.action) {
    case "navigate": {
      if (!isInternalPath(payload.path)) fail(400, "path must be a same-origin route");
      return { action: payload.action, path: payload.path };
    }
    case "open-entity": {
      const command = { action: payload.action, id: nonEmptyString(payload.id, "id") };
      if (payload.ws !== undefined) command.ws = nonEmptyString(payload.ws, "ws");
      return command;
    }
    case "set-workspace":
      return { action: payload.action, ws: nonEmptyString(payload.ws, "ws") };
    case "set-theme":
      if (payload.theme !== "dark" && payload.theme !== "light") {
        fail(400, "theme must be dark or light");
      }
      return { action: payload.action, theme: payload.theme };
    case "set-network":
      return {
        action: payload.action,
        network: nonEmptyString(payload.network, "network"),
      };
    case "set-view":
      if (payload.view !== "graph" && payload.view !== "list") {
        fail(400, "view must be graph or list");
      }
      return { action: payload.action, view: payload.view };
    case "set-filters": {
      const command = { action: payload.action };
      for (const field of ["q", "type", "tag", "preset"]) {
        if (payload[field] !== undefined) {
          command[field] = filterString(payload[field], field);
        }
      }
      if (payload.state !== undefined) {
        if (!Number.isInteger(payload.state) || payload.state < 0 || payload.state > 5) {
          fail(400, "state must be an integer from 0 to 5");
        }
        command.state = payload.state;
      }
      return command;
    }
    case "set-color-mode":
      if (payload.mode !== "type" && payload.mode !== "state") {
        fail(400, "mode must be type or state");
      }
      return { action: payload.action, mode: payload.mode };
    case "set-sidebar":
      if (typeof payload.hidden !== "boolean") {
        fail(400, "hidden must be a boolean");
      }
      return { action: payload.action, hidden: payload.hidden };
    case "reload":
      return { action: payload.action };
    case "toast":
      return {
        action: payload.action,
        message: nonEmptyString(payload.message, "message"),
      };
    default:
      fail(400, "unsupported control action");
  }
}

export async function controlRoutes(app, options = {}) {
  const defaultUser = options.defaultUser ?? process.env.OUTPOST_DEFAULT_USER;
  const registry = options.registry ?? new ControlRegistry();
  const ownsRegistry = options.registry === undefined;

  if (ownsRegistry) app.addHook("onClose", async () => registry.close());

  app.get("/stream", (request, reply) => {
    const username = controlUser(request, defaultUser);
    reply.raw.statusCode = 200;
    reply.raw.setHeader("content-type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("cache-control", "no-cache, no-transform");
    reply.raw.setHeader("connection", "keep-alive");
    reply.raw.setHeader("x-accel-buffering", "no");
    reply.hijack();
    reply.raw.flushHeaders?.();

    const remove = registry.add(username, reply.raw);
    reply.raw.once("close", remove);
    reply.raw.once("error", remove);
  });

  app.post("/command", async (request) => {
    const username = controlUser(request, defaultUser);
    const payload = request.body;
    const command = validateCommand(payload);

    let target = username;
    if (Object.hasOwn(payload, "target")) {
      target = nonEmptyString(payload.target, "target").trim();
      if (!isLocalAddress(request.ip)) {
        fail(403, "target is only allowed from localhost");
      }
    }

    const delivered = registry.deliver(target, { id: randomUUID(), ...command });
    request.log.info({ username, target, action: command.action, delivered },
      "Control command delivered");
    return { delivered };
  });
}

function outside(root, target) {
  const relative = path.relative(root, target);
  return relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
}

async function pageFile(workspace, requested) {
  if (
    typeof requested !== "string" ||
    !requested ||
    requested.includes("\0") ||
    requested.includes("\\") ||
    requested.split("/").includes("..") ||
    path.isAbsolute(requested)
  ) {
    fail(400, "Geçersiz sayfa yolu");
  }
  const extension = path.extname(requested).toLowerCase();
  if (!PAGE_TYPES.has(extension)) fail(400, "Desteklenmeyen sayfa dosyası");

  const workspaceRoot = await fs.realpath(workspace.directory).catch((error) => {
    if (error.code === "ENOENT") fail(404, "Workspace dizini bulunamadı");
    throw error;
  });
  const root = path.join(workspace.directory, "pages");
  const canonicalRoot = await fs.realpath(root).catch((error) => {
    if (error.code === "ENOENT") fail(404, "Sayfa bulunamadı");
    throw error;
  });
  if (outside(workspaceRoot, canonicalRoot)) fail(400, "Sayfa kökü workspace dışında");

  const target = path.resolve(root, requested);
  if (outside(root, target)) fail(400, "Geçersiz sayfa yolu");
  const canonicalTarget = await fs.realpath(target).catch((error) => {
    if (error.code === "ENOENT") fail(404, "Sayfa bulunamadı");
    throw error;
  });
  if (outside(canonicalRoot, canonicalTarget)) fail(400, "Sayfa yolu workspace dışında");
  const stat = await fs.stat(canonicalTarget);
  if (!stat.isFile()) fail(404, "Sayfa bulunamadı");
  return { path: canonicalTarget, type: PAGE_TYPES.get(extension) };
}

export async function workspacePageRoutes(app, { resolveWorkspace }) {
  app.get("/pages/*", async (request, reply) => {
    const file = await pageFile(resolveWorkspace(request), request.params["*"]);
    return reply.type(file.type).send(await fs.readFile(file.path));
  });
}
