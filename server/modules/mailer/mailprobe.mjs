import net from "node:net";
import { resolveMx } from "node:dns/promises";
import { randomBytes } from "node:crypto";

// RCPT-TO probe: hedef MX'e bağlanıp kutunun var olup olmadığını mail
// GÖNDERMEDEN sorar (MAIL FROM / RCPT TO el sıkışması, DATA yok). Gönderim
// zaten Brevo relay'inden; bu yalnız doğrulama (Tuna 2026-07-17: eski
// "no SMTP probe" kuralı bu iş için gevşetildi, probe bizim IP'den).

const DEFAULT_FROM = process.env.OUTPOST_PROBE_FROM || "destek@probotstudio.com";
const DEFAULT_HELO = process.env.OUTPOST_PROBE_HELO || "probotstudio.com";

function readReply(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      // SMTP çok satırlı yanıt: "250-..." devam, "250 ..." biter.
      const lines = buf.split(/\r?\n/).filter(Boolean);
      const last = lines.at(-1);
      if (last && /^\d{3} /.test(last)) {
        cleanup();
        resolve({ code: Number(last.slice(0, 3)), text: buf.trim() });
      }
    };
    const onErr = (err) => { cleanup(); reject(err); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("timeout")); }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("error", onErr);
    }
    socket.on("data", onData);
    socket.on("error", onErr);
  });
}

function send(socket, line) {
  socket.write(line + "\r\n");
}

// Tek bir MX host'una tek RCPT sorgusu (birden çok localpart tek oturumda).
async function probeSession(mxHost, domain, localparts, { from, helo, timeoutMs }) {
  const socket = net.createConnection({ host: mxHost, port: 25 });
  socket.setTimeout(timeoutMs);
  const results = {};
  try {
    await new Promise((res, rej) => {
      socket.once("connect", res);
      socket.once("error", rej);
      socket.once("timeout", () => rej(new Error("connect timeout")));
    });
    const greet = await readReply(socket, timeoutMs);
    if (greet.code !== 220) return { error: `greeting ${greet.code}`, results };
    send(socket, `EHLO ${helo}`);
    await readReply(socket, timeoutMs);
    send(socket, `MAIL FROM:<${from}>`);
    const mailResp = await readReply(socket, timeoutMs);
    if (mailResp.code >= 400) return { error: `MAIL FROM ${mailResp.code}`, results };
    // Tek MAIL FROM altında çoklu RCPT (RSET yok: zarfı sıfırlar ve sonraki
    // RCPT'yi 503 yapar). Aralarında küçük nefes.
    for (const lp of localparts) {
      send(socket, `RCPT TO:<${lp}@${domain}>`);
      const r = await readReply(socket, timeoutMs);
      results[lp] = { code: r.code, accepted: r.code >= 200 && r.code < 300 };
      await new Promise((res) => setTimeout(res, 250));
    }
    send(socket, "QUIT");
    return { results };
  } catch (error) {
    return { error: error.message, results };
  } finally {
    socket.destroy();
  }
}

const COMMON_EXISTING = ["info", "destek", "support", "help", "hello", "iletisim"];

// Domain doğrulanabilir mi: rastgele-yok adres RED, yaygın adreslerden biri
// KABUL olmalı. Rastgele KABUL olursa domain catch-all (probe anlamsız).
export async function probeDomain(domain, {
  from = DEFAULT_FROM, helo = DEFAULT_HELO, timeoutMs = 12_000,
  existingSamples = COMMON_EXISTING, randomLocal = null,
} = {}) {
  let mx;
  try {
    mx = (await resolveMx(domain)).sort((a, b) => a.priority - b.priority);
  } catch {
    return { domain, state: "no_mx" };
  }
  if (!mx.length) return { domain, state: "no_mx" };
  const mxHost = mx[0].exchange;
  const rnd = randomLocal || `nope-${randomBytes(6).toString("hex")}`;
  const { results, error } = await probeSession(
    mxHost, domain, [rnd, ...existingSamples], { from, helo, timeoutMs },
  );
  if (error && !Object.keys(results).length) return { domain, mx: mxHost, state: "blocked", error };
  const randomAccepted = results[rnd]?.accepted;
  const anyExisting = existingSamples.find((s) => results[s]?.accepted);
  let state;
  if (randomAccepted) state = "catch_all";       // her şeyi kabul → ayırt edemez
  else if (anyExisting) state = "discriminating"; // yok'u reddetti, var'ı kabul etti → GÜVENİLİR
  else if (results[rnd]?.code >= 500) state = "strict"; // reddediyor ama yaygınları da bulamadık
  else state = "blocked";                          // greylist/temp/kararsız
  return { domain, mx: mxHost, state, randomCode: results[rnd]?.code,
    existingHit: anyExisting ?? null, results };
}

// Kişi adresini doğrula: TEK oturumda random + hedef sor (greylisting riskini
// azaltır). random KABUL → catch_all; hedef KABUL & random RED → passed;
// hedef 5xx → not_found; belirsiz → blocked.
export async function verifyMailbox(email, opts = {}) {
  const [localpart, domain] = String(email).split("@");
  if (!localpart || !domain) return { email, probe_state: "invalid" };
  let mx;
  try {
    mx = (await resolveMx(domain)).sort((a, b) => a.priority - b.priority);
  } catch {
    return { email, probe_state: "no_mx" };
  }
  if (!mx.length) return { email, probe_state: "no_mx" };
  const mxHost = mx[0].exchange;
  const rnd = `nope-${randomBytes(6).toString("hex")}`;
  const { results, error } = await probeSession(
    mxHost, domain, [rnd, localpart],
    { from: opts.from ?? DEFAULT_FROM, helo: opts.helo ?? DEFAULT_HELO, timeoutMs: opts.timeoutMs ?? 12_000 },
  );
  const target = results[localpart];
  const random = results[rnd];
  if (random?.accepted) {
    return { email, probe_state: "catch_all", mx: mxHost, at: new Date().toISOString() };
  }
  if (!target) return { email, probe_state: "blocked", mx: mxHost, error, at: new Date().toISOString() };
  let state;
  if (target.accepted) state = "passed";
  else if (target.code >= 500) state = "not_found";
  else state = "blocked"; // 4xx greylist/temp
  return { email, probe_state: state, code: target.code, mx: mxHost, at: new Date().toISOString() };
}
