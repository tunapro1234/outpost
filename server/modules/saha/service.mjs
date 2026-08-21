// Saha kayıtları: FTC anketi ve görüşme özetleri.
//
// Bu iki veri kümesi bilerek vault'un DIŞINDA duruyor. `ftc-vault` türetilmiş
// bir ağaç (build-ftc.mjs onu yeniden üretir); oraya yazılan her şey bir
// sonraki rebuild'de kaybolur. Tuna'nın telefonda topladığı beyan verisi
// kaybolamaz, o yüzden kalıcı yer /srv/probot/outreach/arastirma altında.
//
// Yol SABİT ve kayıtlıdır — anket dosyalarının sahibi probot-anket, okuyucusu
// da build-ftc.mjs. Testte/başka kurulumda OUTPOST_ARASTIRMA_DIR ile ezilir.
import { promises as fs } from "node:fs";
import path from "node:path";
import { openWorkspaceDb } from "../../lib/db.mjs";

export const ARASTIRMA_DIR =
  process.env.OUTPOST_ARASTIRMA_DIR ?? "/srv/probot/outreach/arastirma";

export const SORULAR_PATH = path.join(ARASTIRMA_DIR, "ftc-anket-sorular.json");
export const CEVAPLAR_PATH = path.join(ARASTIRMA_DIR, "ftc-anket-cevaplar.json");
export const GORUSME_DIR = path.join(ARASTIRMA_DIR, "beyan", "gorusme-ozetleri");

export const GORUSME_KANALLARI = new Set(["telefon", "yuzyuze", "whatsapp"]);

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

// Takım no hem JSON anahtarı hem dosya adı oluyor: rakam dışında hiçbir şeye
// izin verme (yol kaçışı ve anahtar kirlenmesi tek kontrolle kapanır).
export function normalizeTakimNo(raw) {
  const value = String(raw ?? "").trim();
  if (!/^\d{1,8}$/.test(value)) fail(400, "takim_no yalnızca rakamlardan oluşmalı");
  return value;
}

async function readJson(filePath, { optional = false, fallback = null } = {}) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (optional && error.code === "ENOENT") return fallback;
    if (error.code === "ENOENT") fail(404, `Dosya bulunamadı: ${filePath}`);
    throw error;
  }
}

// tmp + rename: dosyayı build-ftc.mjs ve elle bakan insanlar da okuyor, yarım
// yazılmış JSON görmemeliler.
async function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 1)}\n`, "utf8");
  try {
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export async function readSorular() {
  const data = await readJson(SORULAR_PATH);
  const sorular = Array.isArray(data?.sorular) ? data.sorular : [];
  return {
    version: typeof data?.version === "string" ? data.version : null,
    sorular: sorular.map((soru) => ({
      id: String(soru?.id ?? ""),
      blok: soru?.blok ?? null,
      soru: String(soru?.soru ?? ""),
    })).filter((soru) => soru.id && soru.soru),
  };
}

async function readCevaplarDosyasi() {
  const data = await readJson(CEVAPLAR_PATH, {
    optional: true,
    fallback: { kayitlar: {} },
  });
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail(500, "Cevap dosyası nesne değil");
  }
  if (!data.kayitlar || typeof data.kayitlar !== "object" || Array.isArray(data.kayitlar)) {
    data.kayitlar = {};
  }
  return data;
}

export async function listAnketKayitlari(takimNo) {
  const data = await readCevaplarDosyasi();
  const rows = data.kayitlar[normalizeTakimNo(takimNo)];
  return Array.isArray(rows) ? rows : [];
}

function normalizeCevaplar(raw) {
  if (!Array.isArray(raw)) fail(400, "cevaplar dizi olmalı");
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      fail(400, "her cevap {soru, cevap} nesnesi olmalı");
    }
    const soru = String(item.soru ?? "").trim();
    const cevap = String(item.cevap ?? "").trim();
    // Yalnız DOLDURULANLAR kaydedilir: boş alan "cevap vermedi" demek değil,
    // "sorulmadı/atlandı" demek — dosyaya boş satır yazmak ikisini karıştırır.
    if (!soru || !cevap) continue;
    out.push({ soru, cevap });
  }
  if (!out.length) fail(400, "en az bir soru doldurulmalı");
  return out;
}

function optionalLine(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(400, `${field} metin olmalı`);
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Yeni anket kaydını APPEND eder. Mevcut kayıtlar asla silinmez/ezilmez ve
 * dosyadaki `_` ile başlayan meta alanları (sözleşme, örnek) olduğu gibi
 * kalır — dosyayı parse edip aynı nesneyi geri yazdığımız için otomatik.
 */
export async function appendAnketKaydi(takimNo, payload, { now = () => new Date() } = {}) {
  const no = normalizeTakimNo(takimNo);
  const cevaplar = normalizeCevaplar(payload?.cevaplar);
  const { version } = await readSorular();
  const data = await readCevaplarDosyasi();
  const kayit = {
    anket_versiyon: version,
    tarih: now().toISOString().slice(0, 10),
    cevaplayan: optionalLine(payload?.cevaplayan, "cevaplayan"),
    kanal: "outpost-form",
    kaynak_tipi: "beyan",
    cevaplar,
  };
  const not = optionalLine(payload?.not, "not");
  if (not) kayit.not = not;
  const mevcut = Array.isArray(data.kayitlar[no]) ? data.kayitlar[no] : [];
  data.kayitlar[no] = [...mevcut, kayit];
  await writeJsonAtomic(CEVAPLAR_PATH, data);
  return kayit;
}

// ---- görüşme özetleri --------------------------------------------------

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) continue;
    meta[kv[1]] = kv[2].replace(/^"(.*)"$/, "$1");
  }
  return { meta, body: text.slice(match[0].length) };
}

export async function listGorusmeler(takimNo) {
  const no = normalizeTakimNo(takimNo);
  let names;
  try {
    names = await fs.readdir(GORUSME_DIR);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const mine = names.filter((name) => name.startsWith(`${no}-`) && name.endsWith(".md"));
  mine.sort().reverse();
  const out = [];
  for (const name of mine) {
    const text = await fs.readFile(path.join(GORUSME_DIR, name), "utf8");
    const { meta, body } = parseFrontmatter(text);
    out.push({
      dosya: name,
      yol: path.join(GORUSME_DIR, name),
      takim_no: meta.takim_no ?? no,
      tarih: meta.tarih ?? null,
      kanal: meta.kanal ?? null,
      ozet: body.trim(),
    });
  }
  return out;
}

function fileStamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * Görüşme özeti iki yere düşer: kalıcı md dosyası (insan okur, git'siz de
 * kalıcı) ve `interaction` satırı (Outpost'un temas geçmişi bunu sayar).
 * İkisi tek çağrıda yazılır ki "dosya var ama temas görünmüyor" hali doğmasın.
 */
export async function saveGorusme(
  workspace,
  { entityId, network, takimNo, kanal, ozet },
  { now = () => new Date() } = {},
) {
  const no = normalizeTakimNo(takimNo);
  if (!GORUSME_KANALLARI.has(kanal)) {
    fail(400, "kanal telefon, yuzyuze veya whatsapp olmalı");
  }
  const text = typeof ozet === "string" ? ozet.trim() : "";
  if (!text) fail(400, "ozet boş olamaz");

  const stamp = now();
  const name = `${no}-${fileStamp(stamp)}.md`;
  const target = path.join(GORUSME_DIR, name);
  await fs.mkdir(GORUSME_DIR, { recursive: true });
  const frontmatter = [
    "---",
    `takim_no: ${no}`,
    `tarih: "${stamp.toISOString()}"`,
    `kanal: ${kanal}`,
    "kaynak_tipi: beyan",
    "---",
    "",
  ].join("\n");
  await fs.writeFile(target, `${frontmatter}${text}\n`, "utf8");

  const isoNow = stamp.toISOString();
  const firstLine = text.split("\n").map((line) => line.trim())
    .find((line) => line && !line.startsWith("#")) ?? text.slice(0, 200);
  const db = openWorkspaceDb(workspace);
  const result = db.prepare(
    `INSERT INTO interaction
       (workspace, network, entity_id, channel, direction, at, note, source, created_at)
     VALUES (?, ?, ?, ?, 'in', ?, ?, ?, ?)`,
  ).run(
    workspace.id,
    network,
    entityId,
    kanal,
    isoNow,
    firstLine.slice(0, 300),
    target,
    isoNow,
  );

  return {
    dosya: name,
    yol: target,
    takim_no: no,
    tarih: isoNow,
    kanal,
    ozet: text,
    interaction_id: Number(result.lastInsertRowid),
  };
}
