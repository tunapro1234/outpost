# SPEC-ASSIST — kişisel asistan + kişiye özel dashboard (2026-07-17)

Tuna: Overview tepesinde kocaman prompt barı ("ne yapmak/görmek istersin"); her kullanıcı için
sistem içinde READ-ONLY bir tmux agent açılır; agent salt-okur AMA o kullanıcının dashboard
düzenini değiştirebilir; dashboard'lar kişiye özeldir; agent kullanıcının tercihlerini kaydeder,
panelleri tanıtır, en son nerede kaldığını gösterir. Model: **sonnet-5 medium** (Tuna kararı).

## Kimlik
Her istekte kullanıcı = X-Remote-User (yoksa OUTPOST_DEFAULT_USER; yoksa 401). Owner (tuna)
için mevcut Copilot aynen kalır; asistan HERKES için (owner dahil — owner iki araca da sahip).

## Dashboard layout (kişiye özel)
- Dosya: `<workspace>/dashboards/<user>.json` → `{ "sections": [ { "id": "kpis"|"prompt"|
  "maildrafts"|"mailchart"|"types"|"activity"|<gelecek>, "visible": bool } ... sıra=dizi sırası ],
  "notes": { serbest anahtar-değer (asistanın kullanıcı tercihleri; ör. mail_tone: "resmi") } }`
- `GET /api/ws/:ws/dashboard` → kullanıcının layout'u (yoksa default layout döner).
- `PUT /api/ws/:ws/dashboard` → tam layout yazar (doğrulama: bilinen section id'leri, max 40 not).
- Overview sayfası layout'a göre render eder: sıra + görünürlük. Prompt barı her zaman en üstte
  (gizlenemez tek bölüm).

## Asistan tmux agent (kullanıcı başına)
- Oturum adı: `op-ws-<kod>-usr-<ad-soyad>` (rush uyumlu outpost-main-<user> DEĞİL — kısa tutuyoruz;
  bp'ye kayıt gerekmez, kalıcı-önemsiz agent).
- Yoksa server spawn eder: `tmux new-session -d -s op-ws-<kod>-usr-<ad-soyad> -c <workspace-dizini>
  '<OUTPOST_CLAUDE_BIN> --dangerously-skip-permissions --model claude-sonnet-5'` + açılışta
  brief gönderir (aşağıdaki talimat dosyası).
- Talimat: `<workspace>/assistant/CLAUDE-ASSIST.md` (server ilk kullanımda şablondan yazar,
  şablon repo: `server/modules/assistant/assistant-brief.md`). İçerik: SEN <user> kullanıcısının
  kişisel Outpost asistanısın; SALT-OKUR çalışırsın (vault/stage/config'e YAZMA, git yok, mail
  gönderme yok); tek yazma yetkin: kullanıcının dashboard'u ve notları — bunun için
  `curl -X PUT localhost:3002/api/ws/<ws>/dashboard -H "X-Remote-User: <user>"` kullanırsın;
  görevlerin: soruları vault/API'den cevapla, panelleri tanıt, kullanıcının nerede kaldığını
  hatırlat (dashboards/<user>.json notes.last_context alanını güncelle), mail yazım tercihlerini
  notes'a kaydet; copilot dosya protokolünün aynısı: inbox/outbox/<id>.md + .done —
  dizinler `<workspace>/assistant/<user>/{inbox,outbox}`.
- Köprü: copilot tmux-bridge genelleştirilir (session adı + inbox/outbox kökü parametreli).
  `POST /api/ws/:ws/assistant` gövde {message, thread_id?} → SSE stream (copilot ile aynı akış);
  oturum yoksa spawn + brief + 1 kez bekle; spawn başarısızsa anlaşılır hata (headless fallback YOK
  — asistanın kalıcı kişisel bağlamı olması isteniyor).
- Güvenlik: asistan komutu SADECE kendi kullanıcısının dashboard'una yazabilir (PUT dashboard
  endpoint'i X-Remote-User ile eşleşir; agent brief'ine kendi kullanıcı adı gömülür).

## UI (Overview)
- En üstte büyük, davetkâr prompt barı: placeholder "What do you want to do — or see?" (EN).
  Enter → sağda asistan çekmecesi açılır (CopilotDrawer kalıbı; başlık "Assistant", kullanıcının
  adıyla), mesaj gönderilir, SSE cevabı akar. Copilot çekmecesi owner için ayrıca durur.
- Dashboard render'ı layout'tan: bölüm sırası/görünürlüğü kişiye özel; layout değişince
  (asistan PUT ettiğinde) Overview bir sonraki poll'da yenilenir (dashboard GET'i 15 sn'de bir
  veya asistan cevabı bitince yeniden çek).
