// Gönderilecek mailin nihai halini kurar (dispatcher kullanır). SAF fonksiyon:
// I/O yok, zaman dışarıdan gelir. HTML gövdeye izleme pikseli gömülür ve linkler
// tıklama-redirect URL'leriyle sarmalanır; düz-metin alternatifi izlemesiz kalır
// (bazı client'lar HTML yüklemez — o zaman en azından mail okunur). Message-ID
// izleme token'ından türetilir ki Brevo relay'e verildiğinde reply threading ve
// webhook eşleşmesi tutsun.

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function domainOf(address) {
  const match = /@([^\s>]+)/u.exec(String(address ?? ""));
  return match ? match[1] : "probotstudio.com";
}

// Orijinal link → tıklama-redirect URL eşlemesi. `links` (gövdeden çıkarılan
// sıralı orijinaller) ile `clickUrls` (aynı sıradaki redirect'ler) hizalıdır.
function linkMap(links, clickUrls) {
  const map = new Map();
  links.forEach((original, index) => {
    if (clickUrls[index]) map.set(original, clickUrls[index]);
  });
  return map;
}

function htmlBody(text, map, pixelUrl) {
  const escaped = escapeHtml(text);
  // Linkleri anchor'a çevir (varsa tıklama-redirect hedefiyle).
  const linked = escaped.replace(/https?:\/\/[^\s<>"')]+/gu, (raw) => {
    const clean = raw.replace(/[.,;:]+$/u, "");
    const trail = raw.slice(clean.length);
    const href = map.get(clean) ?? clean;
    return `<a href="${escapeHtml(href)}">${escapeHtml(clean)}</a>${trail}`;
  });
  const paragraphs = linked.split(/\n{2,}/u)
    .map((block) => `<p>${block.replace(/\n/gu, "<br>")}</p>`)
    .join("\n");
  const pixel = pixelUrl
    ? `\n<img src="${escapeHtml(pixelUrl)}" width="1" height="1" alt="" style="border:0;width:1px;height:1px;">`
    : "";
  return `<!doctype html><html><body style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#111">\n${paragraphs}${pixel}\n</body></html>`;
}

export function messageId(token, { now = () => new Date(), domain = "probotstudio.com" } = {}) {
  const stamp = now().toISOString().replace(/[^0-9]/gu, "");
  const local = token && /^[a-f0-9]{8,}$/u.test(token) ? token : "outpost";
  return `<${local}.${stamp}@${domain}>`;
}

export function renderMail(mail, {
  from = "destek@probotstudio.com",
  pixelUrl = null,
  clickUrls = [],
  links = [],
  now = () => new Date(),
} = {}) {
  const to = mail.to_addr ?? mail.to ?? null;
  const domain = domainOf(from);
  const id = messageId(mail.track_token, { now, domain });
  const map = linkMap(Array.isArray(links) ? links : [], Array.isArray(clickUrls) ? clickUrls : []);
  const text = String(mail.body ?? "");
  const html = htmlBody(text, map, pixelUrl);
  return {
    message_id: id,
    subject: mail.subject ?? "",
    from,
    to,
    headers: {
      "Message-ID": id,
      From: from,
      To: to ?? "",
      Subject: mail.subject ?? "",
      "MIME-Version": "1.0",
    },
    text,
    html,
    // Brevo relay'e verildiğinde token'ı tag olarak geçireceğiz (webhook eşleşmesi).
    tags: mail.track_token ? [mail.track_token] : [],
  };
}
