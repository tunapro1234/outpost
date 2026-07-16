import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import yaml from "js-yaml";

const run = promisify(execFile);
const DEFAULT_USER = {
  username: "tuna",
  name: "Tuna",
  mail: "",
  phone: "",
  role: "owner",
};

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function publicProfile(user) {
  return {
    username: user.username,
    name: user.name ?? "",
    mail: user.mail ?? "",
    phone: user.phone ?? "",
    role: user.role ?? "",
  };
}

export class UserStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.fallback = { users: [{ ...DEFAULT_USER }] };
    this.writeQueue = Promise.resolve();
  }

  async read() {
    try {
      const document = yaml.load(await fs.readFile(this.filePath, "utf8"));
      if (!document || typeof document !== "object" || !Array.isArray(document.users)) {
        throw new Error("users.yaml içinde users listesi bulunamadı");
      }
      return { document, persistent: true };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { document: this.fallback, persistent: false };
      }
      throw error;
    }
  }

  async get(username) {
    const { document } = await this.read();
    const user = document.users.find((candidate) => candidate?.username === username);
    if (!user) fail(404, "Kullanıcı bulunamadı");
    return publicProfile(user);
  }

  async patch(username, changes) {
    const operation = this.writeQueue.then(async () => {
      const { document, persistent } = await this.read();
      const user = document.users.find((candidate) => candidate?.username === username);
      if (!user) fail(404, "Kullanıcı bulunamadı");
      Object.assign(user, changes);
      if (persistent) {
        await fs.writeFile(this.filePath, yaml.dump(document, { noRefs: true }), "utf8");
      }
      return publicProfile(user);
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }
}

export async function changePassword(filePath, username, current, next) {
  try {
    await run("htpasswd", ["-bv", filePath, username, current]);
  } catch (error) {
    if (typeof error.code === "number") fail(401, "Mevcut şifre yanlış");
    throw error;
  }

  try {
    await run("htpasswd", ["-b", filePath, username, next]);
  } catch {
    fail(500, "Şifre güncellenemedi");
  }
}
