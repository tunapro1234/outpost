import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webIndex = path.join(root, "web", "dist", "index.html");

try {
  await access(webIndex);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  console.log("Web build not found; building web/dist...");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["--prefix", "web", "run", "build"], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await import("../server/index.mjs");
