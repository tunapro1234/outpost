import { promises as fs } from "node:fs";
import {
  TYPE_DIRECTORIES,
  assertSafeVaultPath,
  parseMarkdown,
  serializeMarkdown,
} from "./vault.mjs";

export const ENTITY_TYPES = Object.freeze(Object.keys(TYPE_DIRECTORIES));

export function isEntityType(value) {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(TYPE_DIRECTORIES, value);
}

export async function updateEntityMeta(workspace, entityOrId, patch) {
  const entity = typeof entityOrId === "string"
    ? workspace.index.entities.get(entityOrId)
    : entityOrId;
  if (!entity) {
    const error = new Error("Entity bulunamadı");
    error.statusCode = 404;
    throw error;
  }
  if (patch.type !== undefined && !isEntityType(patch.type)) {
    const error = new Error("Geçerli type zorunlu");
    error.statusCode = 400;
    throw error;
  }
  await assertSafeVaultPath(workspace.vaultPath, entity.filePath);
  const current = parseMarkdown(await fs.readFile(entity.filePath, "utf8"), entity.filePath);
  const nextMeta = { ...current.meta };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete nextMeta[key];
    else nextMeta[key] = value;
  }
  await fs.writeFile(entity.filePath, serializeMarkdown(current.body, nextMeta), "utf8");
  await workspace.index.loadFile(entity.filePath);
  return workspace.index.entities.get(entity.id);
}
