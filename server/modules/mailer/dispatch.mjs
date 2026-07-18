// Gönderim dispatcher'ı — zamanı gelen (scheduled) mailleri alır, nihai halini
// RENDER eder ve işaretler. VARSAYILAN mod "dry_run": HİÇBİR ŞEY GÖNDERİLMEZ,
// sadece "gönderecektim + tam payload" olarak kaydedilir (status=sent_dryrun).
// Gerçek relay (Brevo) yalnız açık config + bir relay fonksiyonu verilirse devreye
// girer; verilmezse dry_run gibi davranır. Böylece sistem komple hazır ama sessiz.
import { mailById, claimDueSends, markSend } from "./store.mjs";
import { renderMail } from "./render.mjs";
import { trackingUrls } from "./tracking.mjs";
import { ingestedWorkspaceMails } from "../mail/service.mjs";

export const DEFAULT_DISPATCH_MODE = process.env.OUTPOST_DISPATCH_MODE ?? "dry_run";

// person_id → gönderim sonrası gelen inbound zamanları (artan). Reply gelince
// bekleyen scheduled maili iptal etmek için kullanılır.
function repliesByPerson(inbound) {
  const map = new Map();
  for (const mail of inbound) {
    if (mail.direction !== "in" || !mail.person_id) continue;
    const at = Date.parse(String(mail.date ?? ""));
    if (!Number.isFinite(at)) continue;
    if (!map.has(mail.person_id)) map.set(mail.person_id, []);
    map.get(mail.person_id).push(at);
  }
  return map;
}

// Tek bir due send'i işler. relay verilmemişse (varsayılan) gerçek gönderim yok.
export async function dispatchOne(workspace, send, {
  now = () => new Date(),
  dispatchMode = DEFAULT_DISPATCH_MODE,
  from = "destek@probotstudio.com",
  relay = null,
  ws = workspace.id ?? "demo",
  replies = null,
} = {}) {
  const mail = mailById(workspace, send.mail_id);
  if (!mail) {
    markSend(workspace, send.id, { status: "failed", error: "mail kaydı yok", sent_at: now().toISOString() });
    return { id: send.id, status: "failed", reason: "no-mail" };
  }
  // REPLY-CANCEL: mail oluşturulduktan sonra kişi bize cevap yazdıysa, bekleyen bu
  // gönderimi (özellikle follow-up'ı) İPTAL et — cevap veren birine tekrar mail atma.
  const sinceMs = Date.parse(String(mail.created_at ?? mail.approved_at ?? ""));
  const personReplies = replies?.get(mail.person_id) ?? [];
  if (Number.isFinite(sinceMs) && personReplies.some((at) => at >= sinceMs)) {
    markSend(workspace, send.id, {
      status: "canceled", error: "reply-received", sent_at: now().toISOString(),
    });
    return { id: send.id, status: "canceled", reason: "replied" };
  }
  const links = Array.isArray(mail.links) ? mail.links : [];
  const urls = trackingUrls(ws, mail.track_token ?? "", links.length);
  const rendered = renderMail(mail, {
    from,
    pixelUrl: mail.track_token ? urls.pixel : null,
    clickUrls: urls.clicks,
    links,
    now,
  });
  const at = now().toISOString();

  // Gerçek gönderim için ÜÇ koşul da gerekli: (1) runtime mod "brevo", (2) bu send
  // KALICI olarak "brevo" schedule edilmiş (dry_run/imported schedule edilmiş bir
  // mail runtime brevo'ya dönse bile ASLA canlı gitmez), (3) relay fonksiyonu var.
  const live = dispatchMode === "brevo" &&
    send.dispatch_mode === "brevo" &&
    typeof relay === "function";
  if (!live) {
    markSend(workspace, send.id, {
      status: "sent_dryrun",
      sent_at: at,
      message_id: rendered.message_id,
      rendered,
    });
    return { id: send.id, status: "sent_dryrun", message_id: rendered.message_id, to: rendered.to };
  }

  try {
    const relayResult = await relay(rendered, { workspace, mail });
    markSend(workspace, send.id, {
      status: "sent",
      sent_at: at,
      message_id: relayResult?.message_id ?? rendered.message_id,
      rendered,
    });
    return { id: send.id, status: "sent", message_id: relayResult?.message_id ?? rendered.message_id, to: rendered.to };
  } catch (error) {
    markSend(workspace, send.id, {
      status: "failed",
      error: String(error?.message ?? error).slice(0, 500),
      attempts: (send.attempts ?? 0) + 1,
    });
    return { id: send.id, status: "failed", reason: error?.message ?? "relay-error" };
  }
}

// Zamanı gelmiş tüm scheduled send'leri işler (rolling: due olanlar zaten
// schedule tarafından zamana yayılmıştır).
export async function dispatchDueSends(workspace, options = {}) {
  const { now = () => new Date(), limit = 50 } = options;
  // Atomik claim: seçilen sendler anında 'sending'e geçer → çakışan tick çift işlemez.
  const due = claimDueSends(workspace, now().toISOString(), { limit });
  // Reply-cancel için gelen kutusunu bir kez yükle (dispatchOne'a paslanır).
  const replies = repliesByPerson(await ingestedWorkspaceMails(workspace).catch(() => []));
  const results = [];
  for (const send of due) {
    results.push(await dispatchOne(workspace, send, { ...options, replies }));
  }
  return {
    processed: results.length,
    dry_run: results.filter((r) => r.status === "sent_dryrun").length,
    sent: results.filter((r) => r.status === "sent").length,
    canceled: results.filter((r) => r.status === "canceled").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
}
