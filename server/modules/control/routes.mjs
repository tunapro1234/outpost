import { randomUUID } from "node:crypto";
import { ControlRegistry } from "./registry.mjs";

const ACTIONS = new Set([
  "navigate",
  "open-entity",
  "set-workspace",
  "set-theme",
  "toast",
]);
const LOCAL_BASE = "http://localhost";

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
