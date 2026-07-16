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
    return reply.type("text/plain; charset=utf-8").send("UI build edilmemiş");
  }
}
