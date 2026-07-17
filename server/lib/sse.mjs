// SSE yardımcıları: başlıkları ANINDA flush et ve üretim boyunca yorum-satırı
// kalp atışı gönder — yoksa nginx ilk byte gelene kadar bekleyip 504 kesiyor
// (2026-07-17 calibration/draft vakası). Yorum satırları (": ...") EventSource
// ve bizim fetch-parser'larımız için görünmezdir.
export function openSse(reply, { heartbeatMs = 15_000 } = {}) {
  reply.raw.statusCode = 200;
  reply.raw.setHeader("content-type", "text/event-stream; charset=utf-8");
  reply.raw.setHeader("cache-control", "no-cache, no-transform");
  reply.raw.setHeader("connection", "keep-alive");
  reply.raw.setHeader("x-accel-buffering", "no");
  reply.hijack();
  reply.raw.write(": connected\n\n");
  const timer = setInterval(() => {
    if (reply.raw.destroyed || reply.raw.writableEnded) return;
    reply.raw.write(": ping\n\n");
  }, heartbeatMs);
  timer.unref?.();
  reply.raw.once("close", () => clearInterval(timer));
  return () => clearInterval(timer);
}
