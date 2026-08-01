#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  WorkspaceRegistry,
  workspaceNetworkView,
} from "../lib/config.mjs";
import {
  TEMAS_NETWORK,
  seedTemasDurumu,
  writeTemasExport,
} from "../modules/temas/service.mjs";

export async function seedWorkspaceTemas(workspace, options = {}) {
  const network = workspace.getNetwork?.(TEMAS_NETWORK) ?? null;
  if (!network) throw new Error("Hedef network bulunamadı");
  const hedef = workspaceNetworkView(workspace, network);
  const inserted = seedTemasDurumu(
    hedef,
    [...hedef.index.entities.values()],
    options,
  );
  if (inserted > 0) await writeTemasExport(hedef);
  return inserted;
}

async function main() {
  const workspacesPath = path.resolve(process.argv[2] ?? "data/workspaces");
  const workspaceId = process.argv[3] ?? "probot";
  const registry = await WorkspaceRegistry.load({
    workspacesPath,
    outpostVault: null,
    defaultWorkspace: workspaceId,
    watch: false,
  });
  try {
    const workspace = registry.get(workspaceId);
    if (!workspace) throw new Error(`Workspace bulunamadı: ${workspaceId}`);
    const inserted = await seedWorkspaceTemas(workspace);
    process.stdout.write(
      inserted
        ? `${inserted} temas durumu tohumlandı.\n`
        : "Temas tohumu zaten güncel; değişiklik yapılmadı.\n",
    );
  } finally {
    await registry.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
