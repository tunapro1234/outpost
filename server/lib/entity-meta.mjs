import { promises as fs } from "node:fs";
import { assertSafeVaultPath, parseMarkdown, serializeMarkdown } from "./vault.mjs";

export async function updateEntityMeta(workspace, entityOrId, patch) {
  const entity = typeof entityOrId === "string"
    ? workspace.index.entities.get(entityOrId)
    : entityOrId;
  if (!entity) {
    const error = new Error("Entity bulunamadı");
    error.statusCode = 404;
    throw error;
  }
  await assertSafeVaultPath(workspace.vaultPath, entity.filePath);
  const current = parseMarkdown(await fs.readFile(entity.filePath, "utf8"), entity.filePath);
  const nextMeta = { ...current.meta, ...patch };
  await fs.writeFile(entity.filePath, serializeMarkdown(current.body, nextMeta), "utf8");
  await workspace.index.loadFile(entity.filePath);
  return workspace.index.entities.get(entity.id);
}
