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

---
# V2 EKLERİ (2026-07-17 öğleden sonra — Tuna steer)

## 8. Reach → "Mail" yeniden adlandırma
Sidebar/route/başlık: Reach → **Mail** (route /mail; /reach yönlenir). Header YENİDEN tasarlanır:
sol tarafta sade başlık + segmented sekme kontrolü (Drafts · Sent · Inbound · Candidates ·
Exclusions), sayı rozetleri küçük/soluk; **Calibration ayrı durur** — sekme satırının sağ ucunda
ayrık, ikonlu bir "Calibration" düğmesi/görünümü (ayrı alt-sayfa hissi, /mail/calibration).

## 9. Calibration Studio (interaktif eğitim döngüsü)
- **Hedef kişi seç** (kuyruktan arama/seçim) → agent o kişiye GERÇEK bir taslak yazar (tek
  varyant; stüdyoda varyant kalabalığı yok).
- Taslağın altında geri bildirim bloğu: **1-5 puan** (yıldız) + "neyi beğendin" / "neyi
  beğenmedin" (kısa metin alanları veya hızlı chip + metin).
- Gönderince: geri bildirim mail agent'a iletilir → agent voice dosyasını günceller → AYNI
  kişiye yeni taslak yazar → döngü. Puan >=4 olursa "bu tarzı kilitleyelim mi?" önerisi.
- Tüm döngü kayıtları mails/calibration/sessions/<user>.jsonl (ts, person, draft, rating,
  liked, disliked) — curator + voice güncellemelerinin kaynağı.
- API: POST /api/ws/:ws/calibration/draft {person_id, feedback?: {rating, liked, disliked}} →
  SSE (agent yeni taslağı yazar; feedback verilmişse önce voice günceller). Kuyruktan kişi
  önerisi: GET /mailqueue zaten var.

## 10. Kullanıcı skill'leri (md yükleme)
- Kullanıcı kendi mail-yazım skill/md dosyalarını yükleyebilir: <ws>/mails/calibration/skills/<user>/*.md
- API: GET (liste+içerik) / PUT /api/ws/:ws/calibration/skills/:name (md, max 64KB, [a-z0-9-]+\.md) /
  DELETE. Writer ve calibration üretimi bu dosyaları prompt'a dahil eder (skills/mail'den SONRA,
  voice dosyasından ÖNCE; çakışmada kullanıcı skill'i kanonik skill'i ezer).
- UI: Calibration Studio'da "Your skills" bölümü: liste, yükle (dosya seç/yapıştır), sil.

## 11. Mail agent model seçimi
- GET/PUT /api/ws/:ws/mailagent/config {model} — seçenekler: "claude-opus-4-8" (default),
  "claude-sonnet-5", "gpt-5.6-sol". Claude modelleri: tmux personal agent o modelle spawn
  (model değişince mevcut -mail oturumu kapatılıp yenisi açılır); gpt-5.6-sol: tmux yerine
  koşu-başına codex exec (aynı prompt sözleşmesi, headless) — dürüst etiket: "no persistent
  memory chat yok, sadece üretim" (chat sekmesi gpt seçiliyken uyarı gösterir; luna LİSTEDE YOK).
- UI: Studio üstünde küçük model seçici + açıklama.

---
# V3 EKLERİ (2026-07-17 akşam — Studio hız turu + brief kartı)

## 12. Studio taslak üretimi — hız profili ve optimizasyonlar
Tuna sorusu: "45+ sn writing mi bilgi çekme mi?". Faz başına ölçüm (POST /calibration/draft,
`app.log.info "calibration draft timing"` marks; opus-4.8):

| Faz | ÖNCE | SONRA |
|---|---|---|
| context (luna codex) | ~15s | **0s** (deterministik) |
| claude spawn → ilk token (MAIL EKRANDA) | ~46s | **~15s** |
| token stream | ~9s | ~9s |
| **ilk-tur mail ekranda** | ~60s | **~15-17s** |
| **rewrite mail ekranda** | ~52s | **~15s** |

Kök neden ölçümle bulundu: ilk-token gecikmesi PROMPT BOYUTUYLA orantılı (ham claude tiny
prompt=3.8s, 19KB prompt=30s), model "düşünmesi"/soğuk başlatma DEĞİL. Uygulananlar:
- **Prompt diyeti:** studio TEK taslak yazar → 4 skill dosyası (~19KB, gereksiz `variants.md` dahil)
  yerine damıtılmış tek `skills/mail/calibration-studio.md` (~5.5KB, tüm kanonik kural + SPEC §7
  yasakları korunur). İlk-token ~46s→~15s.
- **Deterministik bağlam (`brief.mjs`):** luna context çağrısı (~15s) KALDIRILDI; bağlam artık
  vault entity + `resolveEmployer` kenarı + `scorePerson` nedenlerinden LLM'siz (<100ms) kurulur.
  Yazar bağlamı ile brief kartı AYNI kaynaktan türer (tutarlılık garantisi).
- **Rewrite: paralel voice update.** Geri bildirim zaten draft prompt'una red-notları olarak
  giriyor; bu yüzden voice dosyası güncellemesi (tüm dosyayı yeniden yazan ~35s'lik ağır adım)
  DRAFT'I BLOKLAMAZ — draft hemen akar (mail ~15s), voice update PARALEL koşar ve arka planda
  biter. Faz sırası: context → writing → **voice** ("Saving your feedback…"). Voice update artık
  headless (tmux değil): claude modelleri için de gpt yolundaki aynı JSON sözleşmesi → tmux
  oturumuna bağımlılık yok, daha sağlam.
- Faz çipinde süre beklentisi: writing fazında "usually ~15-20s".
- NOT: rewrite ≤15s hedefi "mail ekranda" için tutar; done/feedback-kilit-açılması voice
  update bitince (~40s) olur çünkü yeni voice done'dan önce persist edilir (client refetch doğru
  voice'u görsün). Opus ilk-token'ı ~15s olduğundan "mail ekranda" bunun altına inemez.

## 13. Kişi brief kartı (GET /api/ws/:ws/calibration/brief/:personId)
Deterministik, LLM'siz. Studio'da taslağın ÜSTÜNDE "What the writer knows" kartı:
- `person` {name, role, mail, mail_state, scan_state, scan_depth}, `employer` {name, type,
  relation (kenar etiketi, citation temizlenmiş), meaning}, `hooks[]`, `score` {value, reasons[]},
  `known[]` {label, text, confidence}, `findings[]` {text, urls[]} (note gövdesinin lead
  paragrafı + kaynak URL'leri).
- Güven etiketi: **verified** (yayımlanmış/citation) · **scan** (taramadan) · **unverified**
  (tahmin/etiketsiz). UI'da renkli çip; mail "(tahmin)" tekrarı temizlenir, çip taşır.
- İşveren bilgisi `service.mjs`'teki `resolveEmployer`'dan alınır (hedef-seçim reformuyla tek
  kaynak); brief kendi türetmesini yapmaz.
