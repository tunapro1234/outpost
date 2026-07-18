// Mail açılma/tıklama izleme. Olaylar artık SQLite'ta (store.mail_event); token
// kaydı da kanonik mail satırıdır (store.mail: track_token + links + person_id).
// Açılma metriği gürültülüdür (Apple Mail Privacy / Gmail proxy önden yükler) —
// proxy açılmaları `bot: true` ile işaretlenir ve gerçek "opened"tan ayrılır.
import { updateEntityMeta } from "../../lib/entity-meta.mjs";
import { randomUUID } from "node:crypto";
import { mailByToken, insertEvent, eventsByToken, listMails } from "./store.mjs";

// 1x1 saydam GIF — mail client'ın yükleyeceği piksel.
export const TRACKING_PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

// Proxy/önden-yükleme imzaları: bu açılmalar insan açtı SAYILMAZ (soft sinyal).
const PROXY_UA = [
  "googleimageproxy", "yahoomailproxy", "google-read-aloud",
  "microsoft office", "outlook-ios", "mail.apple.com",
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

// Bir token'ın gönderim/piksel/tıklama URL'leri.
export function trackingUrls(ws, token, linkCount = 0) {
  const base = `${publicBase()}/t`;
  return {
    pixel: `${base}/o/${ws}/${token}.gif`,
    clicks: Array.from({ length: linkCount }, (_unused, index) => `${base}/c/${ws}/${token}/${index}`),
  };
}

// Token kaydı = kanonik mail satırı. person_id + links'i buradan alırız.
export function findTracking(workspace, token) {
  if (!isTrackToken(token)) return null;
  const mail = mailByToken(workspace, token);
  if (!mail) return null;
  return {
    token,
    person_id: mail.person_id,
    company_id: mail.company_id ?? null,
    mail: mail.to_addr ?? null,
    subject: mail.subject ?? null,
    links: Array.isArray(mail.links) ? mail.links : [],
  };
}

function looksLikeProxy(ua) {
  const value = String(ua ?? "").toLowerCase();
  return PROXY_UA.some((needle) => value.includes(needle));
}

export function recordOpen(workspace, token, { ua = null, ip = null, source = "pixel", now = () => new Date() } = {}) {
  const tracking = findTracking(workspace, token);
  if (!tracking) return { ok: false, reason: "unknown-token" };
  const bot = source === "brevo" ? false : looksLikeProxy(ua);
  insertEvent(workspace, { token, type: "open", source, bot, at: now().toISOString(), ua, ip });
  if (!bot) reflectEngagement(workspace, tracking.person_id, "opened", now);
  return { ok: true, bot, tracking };
}

export function recordClick(workspace, token, linkIndex, { ua = null, ip = null, source = "redirect", now = () => new Date() } = {}) {
  const tracking = findTracking(workspace, token);
  if (!tracking) return { ok: false, reason: "unknown-token" };
  const url = tracking.links[linkIndex];
  insertEvent(workspace, {
    token, type: "click", source, at: now().toISOString(),
    link_index: linkIndex, url: url ?? null, ua, ip,
  });
  // Tıklama = açılmanın kesin kanıtı; en güçlü etkileşim.
  reflectEngagement(workspace, tracking.person_id, "clicked", now);
  return { ok: true, url: isHttpUrl(url) ? url : null, tracking };
}

const BREVO_EVENT_MAP = Object.freeze({
  delivered: "delivered", opened: "open", uniqueOpened: "open", proxy_open: "open",
  click: "click", clicks: "click", hardBounce: "bounce", hard_bounce: "bounce",
  softBounce: "bounce", soft_bounce: "bounce", blocked: "bounce", spam: "bounce",
  unsubscribed: "unsubscribe",
});

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

export function ingestBrevo(workspace, payload, { now = () => new Date() } = {}) {
  const token = brevoToken(payload);
  if (!token) return { ok: false, reason: "no-token" };
  const type = BREVO_EVENT_MAP[payload?.event];
  if (!type) return { ok: false, reason: "unhandled-event", event: payload?.event ?? null };
  if (type === "open") return recordOpen(workspace, token, { source: "brevo", now });
  if (type === "click") {
    const tracking = findTracking(workspace, token);
    if (!tracking) return { ok: false, reason: "unknown-token" };
    const index = tracking.links.indexOf(payload?.link ?? payload?.URL);
    return recordClick(workspace, token, index >= 0 ? index : 0, { source: "brevo", now });
  }
  const tracking = findTracking(workspace, token);
  if (!tracking) return { ok: false, reason: "unknown-token" };
  insertEvent(workspace, { token, type, source: "brevo", at: now().toISOString() });
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
  }).catch(() => {});
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// --- toplama (pure) ---
export function summarizeEvents(events) {
  let delivered = false, bounced = false, openCount = 0, proxyOpenCount = 0, clickCount = 0;
  let firstOpen = null, lastOpen = null, lastClick = null;
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
    status, delivered, bounced,
    open_count: openCount, proxy_open_count: proxyOpenCount,
    first_open: firstOpen, last_open: lastOpen,
    click_count: clickCount, last_click: lastClick,
  };
}

export function trackingRows(workspace) {
  const rows = listMails(workspace).map((mail) => {
    const summary = summarizeEvents(eventsByToken(workspace, mail.track_token ?? ""));
    const person = workspace.index?.entities?.get(mail.person_id);
    return {
      token: mail.track_token,
      outbox_id: mail.id,
      person_id: mail.person_id,
      person_name: person?.meta.name ?? mail.person_id,
      company_id: mail.company_id ?? null,
      subject: mail.subject ?? null,
      mail: mail.to_addr ?? null,
      created_at: mail.approved_at ?? mail.created_at,
      status: summary.status ?? "queued",
      ...summary,
    };
  });
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
