import { promises as fs } from "node:fs";
import path from "node:path";

export function apiError(reply, status, message) {
  return reply.code(status).send({ error: message });
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

function contained(root, target) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function canonicalWebFile(webDist, filePath) {
  const root = await fs.realpath(webDist);
  let target = await fs.realpath(filePath);
  if (!contained(root, target)) return null;
  if ((await fs.stat(target)).isDirectory()) {
    target = await fs.realpath(path.join(target, "index.html"));
    if (!contained(root, target)) return null;
  }
  return target;
}

export async function serveWeb(request, reply, webDist) {
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
    filePath = await canonicalWebFile(webDist, filePath);
    if (!filePath) return apiError(reply, 404, "Dosya bulunamadı");
    const data = await fs.readFile(filePath);
    return reply.type(contentType(filePath)).send(data);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
  }
  try {
    const indexPath = await canonicalWebFile(webDist, path.join(webDist, "index.html"));
    if (!indexPath) return apiError(reply, 404, "Dosya bulunamadı");
    const index = await fs.readFile(indexPath);
    return reply.type("text/html; charset=utf-8").send(index);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return reply.type("text/plain; charset=utf-8").send("UI build edilmemiş");
  }
}
