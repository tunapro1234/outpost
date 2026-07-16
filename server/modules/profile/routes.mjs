import { changePassword, UserStore } from "./service.mjs";

const PATCH_FIELDS = new Set(["name", "mail", "phone"]);

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function usernameFor(request, defaultUser) {
  const value = request.headers["x-remote-user"];
  if (value !== undefined) return value;
  if (defaultUser) return defaultUser;
  fail(401, "authentication required");
}

function objectBody(request) {
  const payload = request.body;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail(400, "JSON gövdesi nesne olmalı");
  }
  return payload;
}

export async function profileRoutes(app, options = {}) {
  const usersPath = options.usersPath ?? process.env.OUTPOST_USERS;
  const htpasswdPath = options.htpasswdPath ?? process.env.OUTPOST_HTPASSWD;
  const defaultUser = options.defaultUser ?? process.env.OUTPOST_DEFAULT_USER;
  const users = usersPath ? new UserStore(usersPath) : null;

  function requireUsers() {
    if (!users) fail(503, "Profile is not configured");
    return users;
  }

  app.get("/profile", async (request) => {
    const username = usernameFor(request, defaultUser);
    return requireUsers().get(username);
  });

  app.patch("/profile", async (request) => {
    const username = usernameFor(request, defaultUser);
    const payload = objectBody(request);
    const changes = {};
    for (const [key, value] of Object.entries(payload)) {
      if (!PATCH_FIELDS.has(key)) fail(400, `Profil alanı güncellenemez: ${key}`);
      if (typeof value !== "string") fail(400, `${key} metin olmalı`);
      changes[key] = value;
    }
    return requireUsers().patch(username, changes);
  });

  app.post("/profile/password", async (request) => {
    const username = usernameFor(request, defaultUser);
    if (!htpasswdPath) fail(503, "Password change is not configured");
    const payload = objectBody(request);
    if (typeof payload.current !== "string") fail(400, "current metin olmalı");
    if (typeof payload.next !== "string" || payload.next.length < 6) {
      fail(400, "Yeni şifre en az 6 karakter olmalı");
    }
    await requireUsers().get(username);
    await changePassword(htpasswdPath, username, payload.current, payload.next);
    return { ok: true };
  });
}
