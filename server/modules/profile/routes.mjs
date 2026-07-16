import { changePassword, UserStore } from "./service.mjs";

const DEFAULT_USERS_PATH = "/srv/outpost/users.yaml";
const DEFAULT_HTPASSWD_PATH = "/etc/nginx/.htpasswd-outpost";
const PATCH_FIELDS = new Set(["name", "mail", "phone"]);

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function usernameFor(request) {
  const value = request.headers["x-remote-user"];
  return typeof value === "string" && value ? value : "tuna";
}

function objectBody(request) {
  const payload = request.body;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail(400, "JSON gövdesi nesne olmalı");
  }
  return payload;
}

export async function profileRoutes(app, options = {}) {
  const usersPath = options.usersPath ?? process.env.OUTPOST_USERS ?? DEFAULT_USERS_PATH;
  const htpasswdPath =
    options.htpasswdPath ?? process.env.OUTPOST_HTPASSWD ?? DEFAULT_HTPASSWD_PATH;
  const users = new UserStore(usersPath);

  app.get("/profile", async (request) => users.get(usernameFor(request)));

  app.patch("/profile", async (request) => {
    const payload = objectBody(request);
    const changes = {};
    for (const [key, value] of Object.entries(payload)) {
      if (!PATCH_FIELDS.has(key)) fail(400, `Profil alanı güncellenemez: ${key}`);
      if (typeof value !== "string") fail(400, `${key} metin olmalı`);
      changes[key] = value;
    }
    return users.patch(usernameFor(request), changes);
  });

  app.post("/profile/password", async (request) => {
    const payload = objectBody(request);
    if (typeof payload.current !== "string") fail(400, "current metin olmalı");
    if (typeof payload.next !== "string" || payload.next.length < 6) {
      fail(400, "Yeni şifre en az 6 karakter olmalı");
    }
    const username = usernameFor(request);
    await users.get(username);
    await changePassword(htpasswdPath, username, payload.current, payload.next);
    return { ok: true };
  });
}
