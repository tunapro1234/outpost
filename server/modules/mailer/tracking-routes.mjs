// PUBLIC izleme uçları — alıcının mail client'ı ve Brevo webhook'u vurur, bu yüzden
// AUTH YOK ve workspace path'te taşınır (/t/o/:ws/... ). Piksel her koşulda GIF döner
// (mail client'a asla hata verme); tıklama yalnız KAYITLI linke yönlenir (open-redirect
// yok); Brevo webhook'u opsiyonel paylaşılan anahtarla korunur.
import {
  TRACKING_PIXEL,
  recordOpen,
  recordClick,
  ingestBrevo,
  publicBase,
} from "./tracking.mjs";

function stripGif(value) {
  return String(value ?? "").replace(/\.gif$/iu, "");
}

function clientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return request.ip ?? null;
}

export async function trackingRoutes(app, { registry }) {
  function workspace(ws) {
    try {
      return registry.get(ws);
    } catch {
      return null;
    }
  }

  function sendPixel(reply) {
    reply
      .header("content-type", "image/gif")
      .header("cache-control", "no-store, no-cache, must-revalidate, private")
      .header("pragma", "no-cache")
      .header("expires", "0");
    return reply.send(TRACKING_PIXEL);
  }

  // Açılma pikseli — token geçersiz/bilinmese bile GIF döner, sadece loglamaz.
  app.get("/t/o/:ws/:token", async (request, reply) => {
    const ws = workspace(request.params.ws);
    const token = stripGif(request.params.token);
    if (ws) {
      try {
        await recordOpen(ws, token, {
          ua: request.headers["user-agent"] ?? null,
          ip: clientIp(request),
        });
      } catch {
        // İzleme deposu ölümcül değil; piksel yine de dönmeli.
      }
    }
    return sendPixel(reply);
  });

  // Tıklama — kayıtlı hedefe 302, bulunamazsa güvenli fallback (open-redirect yok).
  app.get("/t/c/:ws/:token/:index", async (request, reply) => {
    const ws = workspace(request.params.ws);
    const index = Number.parseInt(request.params.index, 10);
    let target = publicBase();
    if (ws && Number.isInteger(index)) {
      try {
        const result = await recordClick(ws, stripGif(request.params.token), index, {
          ua: request.headers["user-agent"] ?? null,
          ip: clientIp(request),
        });
        if (result.ok && result.url) target = result.url;
      } catch {
        // yut; her durumda bir yere yönlendir.
      }
    }
    return reply.code(302).header("location", target).send();
  });

  // Brevo webhook — gerçek gönderim relay'i; delivered/opened/click/bounce olayları.
  app.post("/t/brevo/:ws", async (request, reply) => {
    const configuredKey = process.env.OUTPOST_BREVO_WEBHOOK_KEY;
    if (configuredKey && request.query?.key !== configuredKey) {
      return reply.code(401).send({ ok: false });
    }
    const ws = workspace(request.params.ws);
    if (!ws) return reply.code(404).send({ ok: false });
    const payloads = Array.isArray(request.body) ? request.body
      : Array.isArray(request.body?.events) ? request.body.events
      : [request.body];
    let handled = 0;
    for (const payload of payloads) {
      try {
        const result = await ingestBrevo(ws, payload ?? {});
        if (result.ok) handled += 1;
      } catch {
        // tek olay hatası tüm batch'i düşürmesin.
      }
    }
    return reply.send({ ok: true, handled });
  });
}
