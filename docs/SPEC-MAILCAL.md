# SPEC-MAILCAL — kişiye özel mail agent'ı + kalibrasyon + kullanıcı istatistikleri (2026-07-17)

Tuna goal'ü. Mevcut durum: mailleri gather'daki mail-writer yazıyor (luna bağlam + headless
opus çağrısı) — kişiye özel değil. Yeni mimari:

## 1. Kişiye özel MAIL AGENT (tmux, user agent'ın altında)
- Oturum: `op-ws-<kod>-usr-<ad-soyad>-mail` (örn. op-ws-prb-usr-tuna-gul-mail). Model: **opus-4.8**
  (yazı tadı kritik). Parent (bp): kullanıcının personal agent'ı.
- Spawn/köprü: assistant altyapısının aynısı (IS_SANDBOX, TUI-hazır bekleme, Enter-tekrar);
  dizinler `<ws>/mailagent/<user>/{inbox,outbox}`; protokol `[mail <id>]`.
- Brief şablonu `server/modules/mailer/mail-agent-brief.md`: SEN <user>'ın kişisel mail
  yazarısın; skills/mail/* kuralları taban, ÜSTÜNE kullanıcının kalibrasyon dosyası
  (`mails/calibration/<user>.md`) gelir — o SENİN kalemin; kullanıcıyla uzun kalibrasyon
  sohbetleri yaparsın ve vardığınız kararları kalibrasyon dosyasına SEN işlersin (tek yazma
  alanların: kalibrasyon dosyan + mailagent/<user>/). Mail GÖNDEREMEZSİN; approve yok.
- Chat API: `POST /api/ws/:ws/mailagent {message, thread_id?}` → SSE (kimlikli kullanıcının
  kendi mail agent'ı; yoksa spawn).

## 2. Kalibrasyon
- Dosya: `<ws>/mails/calibration/<user>.md` (+ frontmatter `calibrated_at` — agent ya da API
  her güncellemede yeniler). GET/PUT `/api/ws/:ws/calibration` (kendi kullanıcısı; PUT
  calibrated_at damgalar).
- Writer üretimi artık KULLANICININ MAIL AGENT'I üzerinden: write-mail task varyantları
  `[mail <id>]` köprüsüyle o oturumdan ister (prompt: skills + kalibrasyon dosyası + bağlam
  paketi + varsa red notları). Oturum açılamazsa fallback: mevcut headless opus yolu.
  Taslak meta'sına `author: <user>` ve `created_at` (varsa koru) yazılır. V1: pipeline yazarı
  owner (tuna) adına üretir.
- **Bayatlık**: draft.created_at < kullanıcı kalibrasyonunun calibrated_at'i → taslak STALE.
  GET /maildrafts her taslakta `stale: bool` döner. Writer cycle'ı yeni kişi almadan ÖNCE stale
  pending taslakları yeniden üretir (varyantları değiştirir, created_at yeniler; approve edilmişlere
  dokunmaz). UI'da stale rozeti: "outdated — queued for rewrite".

## 3. Kullanıcı istatistikleri + Workspace paneli
- `usage.jsonl` (workspace kökü): her üretim/sohbet olayı `{ts, user, agent, kind:
  draft|redraft|chat|context, tokens_in?, tokens_out?, chars}` — codex "tokens used" çıktısından,
  claude stream-json usage'ından; yoksa chars/4 tahmini (kayda estimated:true).
- `GET /api/ws/:ws/users/stats` → users.yaml'daki kullanıcılar: {user, name, role,
  drafts, approved, rejected (feedback.jsonl+outbox+stage'den), tokens: {in, out, estimated}}.
- UI: sidebar'a Workspace sayfası geri gelir (route /workspace): kullanıcı tablosu (ad, rol,
  yazılan mail, onaylanan, harcanan token) + workspace özeti. Alt selector kalır.

## 4. Reach başlığı + Calibration sekmesi (UI)
- Header toparlanır: tek satır KPI'lar sadeleşir; sekmeler: **Drafts · Calibration · Sent ·
  Inbound · Candidates · Exclusions** (Drafts ilk — asıl iş kuyruğu). Calibration sekmesi:
  solda kalibrasyon dosyası (görüntüle/düzenle + "calibrated at" + kaydet), sağda mail
  agent'ıyla sohbet (uzun konuşma; ChatDrawer bileşeni gömülü panel varyantı ya da sayfa-içi
  chat). Taslaklarda "drafted <göreli zaman>" + stale rozeti.

## 5. Agents sayfası: Global vs Personal
- İki bölüm: **Workspace agents** (pipeline: scout/deepener/writer/scanner — mevcut kartlar)
  ve **Personal agents** (kimlikli kullanıcının: assistant + mail agent; durum çevrimiçi/kapalı,
  son aktivite, "open chat" kısayolları). `GET /api/ws/:ws/personal-agents` → [{kind:
  assistant|mail, session, running, lastActivity?}] (tmux has-session + son dosya zamanları).

## 6. Çekmece UX (önceki mesajdan)
- ChatDrawer: konuşma GEÇMİŞİ — thread listesi (yerel store çoklu thread: başlık=ilk mesaj
  kırpımı, tarih; seç/yeniden aç/sil). "New chat" eskiyi kaybetmez.
- Çekmece overlay DEĞİL: açıkken ana içerik sıkışır (entity panel gibi; content margin/width
  animasyonlu daralır).

## 7. Stil acili
- skills/mail/cold-intro.md yasaklar listesine: koşullu-pazarlıklı giriş kalıbı
  ("...yürütülüyorsa, sizinle konuşmak istedim" tarzı) — alıcının ne yaptığını BİLMEDEN
  yazıldığını itiraf eden cümle kurma; ya hedef seçimini doğrula ya doğrudan değer cümlesi kur.
