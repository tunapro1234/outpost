import { promises as fs } from "node:fs";
import path from "node:path";
import { openWorkspaceDb } from "../../lib/db.mjs";

export const TEMAS_DURUMLARI = new Set([
  "yazilmadi",
  "yazildi",
  "cevap_bekleniyor",
  "cevaplanacak",
  "gorusuldu",
  "kapandi",
]);

export const TEMAS_NETWORK = "hedef";

function rowResult(entityId, row) {
  return {
    entity_id: entityId,
    durum: row?.durum ?? "yazilmadi",
    guncelleme_ts: row?.guncelleme_ts ?? null,
    kaynak: row?.kaynak ?? null,
  };
}

export function getTemasDurumu(workspace, entityId, network = TEMAS_NETWORK) {
  const row = openWorkspaceDb(workspace).prepare(
    `SELECT durum, guncelleme_ts, kaynak
     FROM temas_durumu
     WHERE ws = ? AND network = ? AND entity_id = ?`,
  ).get(workspace.id, network, entityId);
  return rowResult(entityId, row);
}

export function listTemasDurumu(workspace, network = TEMAS_NETWORK) {
  return openWorkspaceDb(workspace).prepare(
    `SELECT entity_id, durum, guncelleme_ts, kaynak
     FROM temas_durumu
     WHERE ws = ? AND network = ?
     ORDER BY entity_id ASC`,
  ).all(workspace.id, network).map((row) => ({
    entity_id: row.entity_id,
    durum: row.durum,
    guncelleme_ts: row.guncelleme_ts,
    kaynak: row.kaynak,
  }));
}

// Export dosyası AĞ BAŞINA ayrı. Tek dosya olsaydı FTC'den atılan her PATCH,
// `hedef` ağının export'unu kendi satırlarıyla ezerdi (dışarıdaki okuyucular
// sessizce yanlış listeyi görürdü). Varsayılan ağın adı DEĞİŞMİYOR: mevcut
// temas-export.json sözleşmesi olduğu gibi duruyor.
export function temasExportName(network = TEMAS_NETWORK) {
  return network === TEMAS_NETWORK
    ? "temas-export.json"
    : `temas-export.${network}.json`;
}

export async function writeTemasExport(workspace, network = TEMAS_NETWORK) {
  const output = `${JSON.stringify(listTemasDurumu(workspace, network), null, 2)}\n`;
  const name = temasExportName(network);
  const target = path.join(workspace.directory, name);
  const temporary = path.join(
    workspace.directory,
    `.${name}.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.writeFile(temporary, output, "utf8");
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  return target;
}

export async function patchTemasDurumu(
  workspace,
  entityId,
  durum,
  { network = TEMAS_NETWORK, now = () => new Date() } = {},
) {
  if (!TEMAS_DURUMLARI.has(durum)) {
    const error = new Error(
      "durum yazilmadi, yazildi, cevap_bekleniyor, cevaplanacak, gorusuldu veya kapandi olmalı",
    );
    error.statusCode = 400;
    throw error;
  }
  const guncellemeTs = now().toISOString();
  openWorkspaceDb(workspace).prepare(
    `INSERT INTO temas_durumu
       (ws, network, entity_id, durum, guncelleme_ts, kaynak)
     VALUES (?, ?, ?, ?, ?, 'ui:tuna')
     ON CONFLICT(ws, network, entity_id) DO UPDATE SET
       durum = excluded.durum,
       guncelleme_ts = excluded.guncelleme_ts,
       kaynak = excluded.kaynak`,
  ).run(workspace.id, network, entityId, durum, guncellemeTs);
  await writeTemasExport(workspace, network);
  return getTemasDurumu(workspace, entityId, network);
}

export function seedTemasDurumu(
  workspace,
  entities,
  { network = TEMAS_NETWORK, now = () => new Date() } = {},
) {
  const fixed = new Map([
    ["selim-cile", "yazilmadi"],
    ["murat-kaya", "cevaplanacak"],
    ["onur-aydemir", "cevap_bekleniyor"],
    ["firat-sevim", "cevap_bekleniyor"],
    ["fatih-tufekci", "yazilmadi"],
  ]);
  const timestamp = now().toISOString();
  const insert = openWorkspaceDb(workspace).prepare(
    `INSERT OR IGNORE INTO temas_durumu
       (ws, network, entity_id, durum, guncelleme_ts, kaynak)
     VALUES (?, ?, ?, ?, ?, 'seed')`,
  );
  let inserted = 0;
  for (const entity of entities) {
    if (["no_contact", "defer"].includes(entity?.meta?.politika_durumu)) continue;
    const result = insert.run(
      workspace.id,
      network,
      entity.id,
      fixed.get(entity.id) ?? "yazilmadi",
      timestamp,
    );
    inserted += Number(result.changes ?? 0);
  }
  return inserted;
}
