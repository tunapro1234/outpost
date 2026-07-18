// Mail açılma/tıklama izleme. Gönderim henüz Brevo relay'e bağlı değil; bu modül
// izleme ALTYAPISINI kurar: her onaylanan maile bir token verilir, maile gömülen
// görünmez piksel (açılma) ve sarmalanan linkler (tıklama) bizim sunucuya düşer,
// ayrıca Brevo webhook'u aynı olay deposunu besler. Açılma metriği gürültülüdür
// (Apple Mail Privacy Protection / Gmail proxy önden yükler) — proxy kaynaklı
// açılmalar `bot: true` ile işaretlenir ve gerçek "opened" sinyalinden ayrılır.
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { updateEntityMeta } from "../../lib/entity-meta.mjs";

// 1x1 saydam GIF — mail client'ın yükleyeceği piksel.
export const TRACKING_PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

// Proxy/önden-yükleme imzaları: bu açılmalar insan açtı SAYILMAZ (soft sinyal).
const PROXY_UA = [
  "googleimageproxy",
  "yahoomailproxy",
  "google-read-aloud",
  "microsoft office",
  "outlook-ios",
  "mail.apple.com",
];

export function publicBase() {
  return (process.env.OUTPOST_PUBLIC_BASE ?? "https://outpost.tunapro.xyz").replace(/\/+$/u, "");
}

export function newToken() {
  return randomUUID().replace(/-/gu, "");
}

export function isTrackToken(value) {
  return typeof value === "string" && /^[a-f0-9]{16,64}$/u.test(value);
}

function trackingPath(workspace) {
  return path.join(workspace.directory, "mails", "tracking.jsonl");
}

function eventsPath(workspace) {
  return path.join(workspace.directory, "mails", "events.jsonl");
}

async function readJsonl(filePath) {
  let source;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const out = [];
  source.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    try {
      out.push(JSON.parse(line));
    } catch {
      // Bozuk satırı sessizce atla; izleme deposu ölümcül değildir.
    }
  });
  return out;
}

async function appendJsonl(filePath, record) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let prefix = "";
  try {
    const current = await fs.readFile(filePath);
    if (current.length && current[current.length - 1] !== 10) prefix = "\n";
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.appendFile(filePath, `${prefix}${JSON.stringify(record)}\n`, "utf8");
}

// Maildeki http(s) linklerini çıkar (tıklama sarmalaması için sıra korunur, tekrar atılır).
export function extractLinks(body) {
  const seen = new Set();
  const links = [];
  for (const match of String(body ?? "").matchAll(/https?:\/\/[^\s<>"')]+/gu)) {
    const url = match[0].replace(/[.,;:]+$/u, "");
    if (seen.has(url)) continue;
    seen.add(url);
    links.push(url);
  }
  return links;
}

// Bir token'ın gönderim/piksel/tıklama URL'leri. Gönderici (Brevo relay bağlanınca)
// bunları maile gömer; şimdilik onay anında hesaplanıp kaydedilir.
export function trackingUrls(ws, token, linkCount = 0) {
  const base = `${publicBase()}/t`;
  return {
    pixel: `${base}/o/${ws}/${token}.gif`,
    clicks: Array.from({ length: linkCount }, (_unused, index) => `${base}/c/${ws}/${token}/${index}`),
  };
}

export async function registerTracking(workspace, {
  ws,
  token,
  outbox_id,
  person_id,
  company_id = null,
  mail = null,
  subject = null,
  links = [],
  now = () => new Date(),
}) {
  const record = {
    kind: "track",
    token,
    ws,
    outbox_id,
    person_id,
    company_id,
    mail,
    subject,
    links,
    created_at: now().toISOString(),
  };
  await appendJsonl(trackingPath(workspace), record);
  return record;
}

// Ham izleme kayıtları — maildb kanonik mail kaydını kurarken join için kullanır.
export async function readTrackingRecords(workspace) {
  return (await readJsonl(trackingPath(workspace))).filter((entry) => entry.kind === "track");
}

export async function readTrackingEvents(workspace) {
  return readJsonl(eventsPath(workspace));
}

export function eventsByToken(events) {
  const map = new Map();
  for (const event of events) {
    if (!map.has(event.token)) map.set(event.token, []);
    map.get(event.token).push(event);
  }
  return map;
}

export async function findTracking(workspace, token) {
  if (!isTrackToken(token)) return null;
  const records = await readJsonl(trackingPath(workspace));
  // Son kayıt kazanır (aynı token yeniden kaydedilirse).
  return records.filter((entry) => entry.kind === "track" && entry.token === token).at(-1) ?? null;
}

function looksLikeProxy(ua) {
  const value = String(ua ?? "").toLowerCase();
  return PROXY_UA.some((needle) => value.includes(needle));
}

export async function recordOpen(workspace, token, { ua = null, ip = null, source = "pixel", now = () => new Date() } = {}) {
  const tracking = await findTracking(workspace, token);
  if (!tracking) return { ok: false, reason: "unknown-token" };
  const bot = source === "brevo" ? false : looksLikeProxy(ua);
  await appendJsonl(eventsPath(workspace), {
    token, type: "open", source, bot, at: now().toISOString(),
    ...(ua ? { ua } : {}), ...(ip ? { ip } : {}),
  });
  if (!bot) await reflectEngagement(workspace, tracking.person_id, "opened", now);
  return { ok: true, bot, tracking };
}

export async function recordClick(workspace, token, linkIndex, { ua = null, ip = null, source = "redirect", now = () => new Date() } = {}) {
  const tracking = await findTracking(workspace, token);
  if (!tracking) return { ok: false, reason: "unknown-token" };
  const url = Array.isArray(tracking.links) ? tracking.links[linkIndex] : undefined;
  await appendJsonl(eventsPath(workspace), {
    token, type: "click", source, at: now().toISOString(),
    link_index: linkIndex, ...(url ? { url } : {}),
    ...(ua ? { ua } : {}), ...(ip ? { ip } : {}),
  });
  // Tıklama = açılmanın kesin kanıtı; en güçlü etkileşim.
  await reflectEngagement(workspace, tracking.person_id, "clicked", now);
  return { ok: true, url: isHttpUrl(url) ? url : null, tracking };
}

const BREVO_EVENT_MAP = Object.freeze({
  delivered: "delivered",
  opened: "open",
  uniqueOpened: "open",
  proxy_open: "open",
  click: "click",
  clicks: "click",
  hardBounce: "bounce",
  hard_bounce: "bounce",
  softBounce: "bounce",
  soft_bounce: "bounce",
  blocked: "bounce",
  spam: "bounce",
  unsubscribed: "unsubscribe",
});

// Brevo webhook payload'ı → olay deposu. Token'ı gönderim anında Brevo tag'ine
// gömeriz; burada tag/header'dan çıkarıp eşleriz.
export function brevoToken(payload) {
  const tags = payload?.tags ?? payload?.tag;
  const list = Array.isArray(tags) ? tags : typeof tags === "string" ? [tags] : [];
  const tagged = list.find((tag) => isTrackToken(String(tag)));
  if (tagged) return String(tagged);
  for (const key of ["X-Outpost-Token", "outpost_token", "token"]) {
    if (isTrackToken(String(payload?.[key]))) return String(payload[key]);
  }
  return null;
}

export async function ingestBrevo(workspace, payload, { now = () => new Date() } = {}) {
  const token = brevoToken(payload);
  if (!token) return { ok: false, reason: "no-token" };
  const type = BREVO_EVENT_MAP[payload?.event];
  if (!type) return { ok: false, reason: "unhandled-event", event: payload?.event ?? null };
  if (type === "open") {
    return recordOpen(workspace, token, { source: "brevo", now });
  }
  if (type === "click") {
    const tracking = await findTracking(workspace, token);
    if (!tracking) return { ok: false, reason: "unknown-token" };
    const index = (tracking.links ?? []).indexOf(payload?.link ?? payload?.URL);
    return recordClick(workspace, token, index >= 0 ? index : 0, { source: "brevo", now });
  }
  const tracking = await findTracking(workspace, token);
  if (!tracking) return { ok: false, reason: "unknown-token" };
  await appendJsonl(eventsPath(workspace), { token, type, source: "brevo", at: now().toISOString() });
  return { ok: true, type };
}

// person meta'ya etkileşimi yansıt (graf/queue görsün). Sadece yukarı yönde tırmanır.
const ENGAGE_RANK = { opened: 1, clicked: 2 };
async function reflectEngagement(workspace, personId, level, now) {
  if (!workspace?.index || !personId) return;
  const person = workspace.index.entities.get(personId);
  if (!person || person.meta.type !== "person") return;
  const current = person.meta.mail_engagement;
  if ((ENGAGE_RANK[current] ?? 0) >= ENGAGE_RANK[level]) return;
  await updateEntityMeta(workspace, person, {
    mail_engagement: level,
    mail_engaged_at: now().toISOString(),
  });
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// --- toplama (Sent görünümü + /mailtracking) ---

export function summarizeEvents(events) {
  let delivered = false;
  let bounced = false;
  let openCount = 0;
  let proxyOpenCount = 0;
  let clickCount = 0;
  let firstOpen = null;
  let lastOpen = null;
  let lastClick = null;
  for (const event of events) {
    if (event.type === "delivered") delivered = true;
    else if (event.type === "bounce") bounced = true;
    else if (event.type === "open") {
      if (event.bot) proxyOpenCount += 1;
      else {
        openCount += 1;
        if (!firstOpen || event.at < firstOpen) firstOpen = event.at;
        if (!lastOpen || event.at > lastOpen) lastOpen = event.at;
      }
    } else if (event.type === "click") {
      clickCount += 1;
      if (!lastClick || event.at > lastClick) lastClick = event.at;
    }
  }
  const status = bounced ? "bounced"
    : clickCount > 0 ? "clicked"
    : openCount > 0 ? "opened"
    : proxyOpenCount > 0 ? "proxy_open"
    : delivered ? "delivered"
    : null;
  return {
    status,
    delivered,
    bounced,
    open_count: openCount,
    proxy_open_count: proxyOpenCount,
    first_open: firstOpen,
    last_open: lastOpen,
    click_count: clickCount,
    last_click: lastClick,
  };
}

export async function trackingRows(workspace) {
  const [tracking, events] = await Promise.all([
    readJsonl(trackingPath(workspace)),
    readJsonl(eventsPath(workspace)),
  ]);
  const byToken = new Map();
  for (const event of events) {
    if (!byToken.has(event.token)) byToken.set(event.token, []);
    byToken.get(event.token).push(event);
  }
  const rows = tracking
    .filter((entry) => entry.kind === "track")
    .map((entry) => {
      const person = workspace.index?.entities.get(entry.person_id);
      const summary = summarizeEvents(byToken.get(entry.token) ?? []);
      return {
        token: entry.token,
        outbox_id: entry.outbox_id,
        person_id: entry.person_id,
        person_name: person?.meta.name ?? entry.person_id,
        company_id: entry.company_id ?? null,
        subject: entry.subject ?? null,
        mail: entry.mail ?? null,
        created_at: entry.created_at,
        // Gönderim henüz bağlı değil: kayıt varsa "queued", olaylar geldikçe yükselir.
        status: summary.status ?? "queued",
        ...summary,
      };
    })
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
  return { rows, counts: rowCounts(rows) };
}

function rowCounts(rows) {
  const counts = { total: rows.length, queued: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 };
  for (const row of rows) {
    if (row.status === "clicked") counts.clicked += 1;
    else if (row.status === "opened" || row.status === "proxy_open") counts.opened += 1;
    else if (row.status === "bounced") counts.bounced += 1;
    else if (row.status === "delivered") counts.delivered += 1;
    else counts.queued += 1;
  }
  return counts;
}
