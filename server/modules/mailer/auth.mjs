import { promises as fs } from "node:fs";
import yaml from "js-yaml";

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
  return value.trim();
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
