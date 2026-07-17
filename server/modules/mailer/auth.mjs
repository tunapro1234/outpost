import { promises as fs } from "node:fs";
import yaml from "js-yaml";

export const SAFE_MAILER_USERNAME = /^[a-z0-9-]{1,24}$/;

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

export function authenticatedMailerUser(request, defaultUser) {
  const header = request.headers["x-remote-user"];
  const value = header === undefined ? defaultUser : header;
  if (typeof value !== "string" || !value.trim()) {
    fail(401, "authentication required");
  }
  const username = value.trim();
  if (!SAFE_MAILER_USERNAME.test(username)) fail(400, "Geçersiz kullanıcı adı");
  return username;
}

export async function mailerUsers({
  usersPath = process.env.OUTPOST_USERS,
  defaultUser = process.env.OUTPOST_DEFAULT_USER,
} = {}) {
  if (usersPath) {
    try {
      const document = yaml.load(await fs.readFile(usersPath, "utf8"));
      if (!document || typeof document !== "object" || !Array.isArray(document.users)) {
        throw new Error("users.yaml içinde users listesi bulunamadı");
      }
      return document.users
        .filter((user) => user && SAFE_MAILER_USERNAME.test(user.username))
        .map((user) => ({
          user: user.username,
          name: typeof user.name === "string" ? user.name : user.username,
          role: typeof user.role === "string" ? user.role : "",
        }));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return typeof defaultUser === "string" && SAFE_MAILER_USERNAME.test(defaultUser)
    ? [{ user: defaultUser, name: defaultUser, role: "owner" }]
    : [];
}

export async function writerUser(options = {}) {
  const users = await mailerUsers(options);
  const configured = users.find((user) => user.role === "owner") ?? users.find((user) =>
    user.user === options.defaultUser);
  if (configured) return configured;
  return typeof options.defaultUser === "string" && SAFE_MAILER_USERNAME.test(options.defaultUser)
    ? { user: options.defaultUser, name: options.defaultUser, role: "owner" }
    : null;
}

async function configuredRole(usersPath, username) {
  const document = yaml.load(await fs.readFile(usersPath, "utf8"));
  if (!document || typeof document !== "object" || !Array.isArray(document.users)) {
    throw new Error("users.yaml içinde users listesi bulunamadı");
  }
  return document.users.find((candidate) => candidate?.username === username)?.role;
}

export async function isMailerOwner(username, {
  usersPath = process.env.OUTPOST_USERS,
  defaultUser = process.env.OUTPOST_DEFAULT_USER,
} = {}) {
  if (usersPath) {
    try {
      return await configuredRole(usersPath, username) === "owner";
    } catch {
      // Yerel tek-kullanıcı kurulumu: users.yaml yoksa, bozuksa veya okunamıyorsa
      // yalnız OUTPOST_DEFAULT_USER owner kabul edilir.
    }
  }
  return typeof defaultUser === "string" && defaultUser.trim() === username;
}

export function requireMailerOwner(owner, message = "approve yetkisi yalnız owner") {
  if (!owner) fail(403, message);
}
