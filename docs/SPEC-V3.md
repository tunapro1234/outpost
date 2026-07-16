# Outpost V3 — Ürün Mimarisi: Gathering / Network / Reach (2026-07-16)

Tuna'nın vizyonu (goal, 2026-07-16): üç bölge — **Gathering** (entegrasyonlardan veri toplayan
agent filosu, n8n kıvamında görünüm), **Network** (ağ + liste; review agent'ları), **Reach**
(yazılmış/yazılabilecek mailler). Yan panel navigasyon, workspace kavramı (probot → compec...),
sağda workspace copilot'u. "Çok karmaşık değil ama kullanışlı."

## 1. Kavramsal model

**Workspace** = bir kampanya/şirket bağlamı. Her workspace'in kendi vault'u, mail log'u, agent
filosu ve copilot'u var. Dizin: `/srv/outpost/workspaces/<ws>/` → `vault/`, `mails/log.jsonl`,
`agents.yaml`, `agent-runs/`, `stage/`, `config.yaml`. İlk workspace: `probot`
(mevcut `/srv/outpost/data/vault` buraya taşınır). Sunucu tarafında her workspace'e tmux agent
hiyerarşisi eşlik eder (`outpost-ws-<ws>` + altında araştırmacı/reviewer subagent'lar) — V3d.

**Veri akışı (tek yön, insan+review süzgeçli):**
```
Entegrasyonlar → [Gathering agent'ları: scrape + classify (luna)]
              → stage/ (vault formatında öneri notları)
              → [Network review agent'ları: dedup + merge + bağlantı keşfi (luna-high, opus örneklem)]
              → vault/ (git commit)  →  graf/liste/entity sayfaları
              → [Reach: değerlendirme + mail adayları + taslaklar]  → İNSAN ONAYI → gönderim (V4)
```
Gathering vault'a DOĞRUDAN yazmaz; stage → review → commit zinciri veri kalitesini korur
(probot fan-out dersleri: duplicate felaketi, kalite denetimi şart).

**Model politikası (Tuna direktifi):** gathering = `gpt-5.6-luna` (ucuz-zeki, medium; derin işte
high). Network review = bir tık zeki + geniş context: default **luna high**; kritik merge
kararlarında **%10 opus-4.8 örneklem denetimi** (öneri — tam-opus pahalı, örneklem probot
pipeline'ında işledi; Tuna isterse tam-opus'a çevrilir). Copilot = opus-4.8.

## 2. Veri modeli ekleri

- **Mail log** `mails/log.jsonl`: `{id, entity_id, person_id?, direction: out|in, date, from, to,
  subject, summary, source: import|vault|manual, utm?}`. İlk dolum: probot `gonderilen.md` +
  `cevaplar.md` + vault `## Mailler` import'u. Entity listelerine türetilmiş alanlar eklenir:
  `mail_count`, `last_mail_date`, `last_mail_direction`, `last_mail_from` (liste filtreleri bunlara
  dayanır: "mail yazılmışlar", "kaç kez, kimden, ne zaman").
- **Agent registry** `agents.yaml`: agent başına `{id, name, zone: gathering|network, model,
  integration, schedule (cron | manual), task (scrape-classify | dedup-review | link-discovery),
  params, enabled}`.
- **Run journal** `agent-runs/<agent-id>/<ts>.json`: `{started, ended, status, items_in, items_out,
  staged, warnings, log_tail, cost_note}`.
- **Stage** `stage/*.md`: vault formatında öneri dosyaları + `stage/decisions.jsonl` (review kararı:
  merge/new/reject + gerekçe).

## 3. Server ekleri

- **WS scoping**: tüm API `/api/ws/:ws/...` altına alınır; eski `/api/*` default workspace'e
  alias (geriye uyum, UI güncellenince kaldırılır).
- `GET .../mails` (log+vault birleşik), `GET .../entities` (mail_* alanları eklenmiş),
  `GET .../agents` (registry + son run özeti), `POST .../agents/:id/run` (manuel tetik),
  `GET .../runs?agent=` (journal), `GET .../stage` (bekleyen öneriler + karar endpoint'i).
- **Runner**: outpost.service içinde cron-lite zamanlayıcı. Job türleri:
  - `scrape`: merkezi browser sunucusu üzerinden hedef URL setini gez (politeness: 2-5sn, düşük rate).
  - `classify`: `codex exec -m gpt-5.6-luna` (structured çıktı, stage'e yaz).
  - `dedup-review`: stage ↔ vault benzerlik (slug/isim/site/telefon eşleşme) + luna-high karar;
    opus örneklem opsiyonu config'te.
  Her run journal'a yazar; hata → run failed + UI'da görünür. TOKEN/secret loglanmaz.
- **Copilot**: `POST /api/ws/:ws/copilot` `{message, thread_id?}` → SSE stream. Backend: `claude -p`
  headless (opus), system prompt = workspace özeti (stats, son run'lar, son mailler, bekleyen stage)
  — v1'de salt-sohbet + hazır bağlam, araç çalıştırma YOK. **Gate: basic-auth kullanıcısı `tuna`
  değilse 403** (nginx $remote_user header'ı proxy'lenir). Diğer kullanıcılar copilot'u ve agent
  uçlarını GÖREMEZ (Tuna: "benim dışımdakiler o agentlara bağlanamasın").

## 4. UI — yan panel navigasyon

**Sol dar sidebar** (ikon+etiket): üstte **Gathering / Network / Reach**; altta ayarlar bölgesi:
**Entegrasyonlar** (şimdilik yeter); en altta **workspace rozeti** (probot) — tık: workspace
listesi (şimdilik tek + "yakında: compec").

- **Network** = v2'deki graf + liste; header ORTASINDA büyük, vurgulu `Ağ | Liste` segment
  kontrolü (Tuna: ikisi ayrı iş görür, ikisi de birinci sınıf). Liste güçlendirmesi: mail kolonları
  (kaç mail, son mail tarihi, kimden, yön), kolon göster/gizle, çoklu sıralama, satırdan entity
  sayfasına git. Filtre durumu ağ ile ORTAK.
- **Entity sayfası** `/e/:id` (tam sayfa; şirket vurgulu ama tüm tipler aynı şablon):
  üst kimlik şeridi (ad, tip, status-pill, skor, iletişim, hook) + sekmeler:
  **Genel** (tanım + ilişkiler + mini ego-graf 1-adım), **Mailler** (o entity'nin tüm trafiği,
  kişi bazında), **Aktivite** (agent run'ları + git değişiklik geçmişi bu dosya için),
  **Not** (body editörü). "Bu şirketle yaptığımız her şey tek yerde."
- **Gathering**: n8n-KIVAMINDA akış görünümü (v1: görselleştirme + kontrol; sürükle-bağla editör
  DEĞİL — karmaşıklık bütçesi): sol kolon entegrasyon/kaynak node'ları → orta: agent node'ları
  (model rozeti, durum ışığı, son run: zaman/item/hata) → sağ: Network hedef node'u; kenarlarda
  akan item sayısı. Node tık → sağ panel: açıklama, ayarlar (schedule, enabled), son run log'u,
  "Şimdi çalıştır" butonu, run geçmişi grafiği (mini sparkline).
- **Reach**: KPI şeridi (toplam gönderim, cevap, cevap oranı, bekleyen takip) + sekmeler:
  **Gönderilen** (log tablosu: tarih/kişi/kurum/konu/yön; entity'e link), **Adaylar**
  (mail'i olan + skor eşiği geçen + henüz yazılmamış; filtreli liste; "neden aday" = kanca gösterimi),
  **Gelen** (cevaplar). Taslak/gönderim V4 (insan onayı kuralı değişmez).
- **Copilot çekmecesi**: sağ kenar, her bölgeden açılır (`⌘K` benzeri kısayol + ikon). Ws-scoped
  sohbet, SSE stream, thread geçmişi localStorage. tuna dışına görünmez.

## 5. Filtreleme

v2 FilterState temel; `docs/SPEC-FILTER.md` ayrıca yazılacak (filtre-UX araştırması
`/srv/outpost/research/filtre-ux.md` sonuçlarıyla): kaydedilmiş view'lar birincil gezinme kalıbı,
chip/token filtre şeridi, outreach'e özgü hazır filtreler ("mail yazılmadı + skor>20",
"30 gündür dokunulmadı", "cevap geldi"), copilot'a doğal-dil filtre ("İstanbul'daki mail'siz
atölyeleri göster" → FilterState).

## 6. Fazlar (sıra; her faz canlıya çıkar)

- **V3a — kabuk**: sidebar IA, ws-scoped API + workspace dizin taşıma, Network liste güçlendirme
  (mail kolonları), entity sayfası, Reach v1 (mail import + Gönderilen/Adaylar), Entegrasyonlar
  sidebar'a. 
- **V3b — agents**: registry + runner + 2 GERÇEK agent (1: `site-tarayıcı` gathering — vault'taki
  site'i olan ama mail'i olmayan kurumların sitelerini gezip iletişim bilgisi çıkarır, luna
  classify, stage'e yazar; 2: `dedup-review` network — stage↔vault dedup kararları) + Gathering
  canvas + agent-run journal UI.
- **V3c — copilot**: endpoint + çekmece + tuna-gate.
- **V3d — workspace çoğaltma**: compec workspace + `outpost-ws-compec` tmux hiyerarşisi + login
  bazlı copilot ayrımı (kullanıcı yönetimi büyürse basic-auth'tan oturuma geçiş burada düşünülür).

## 6.5 Tuna ek direktifleri (2026-07-16, canlı steer)

- **UI dili İNGİLİZCE** (tüm label/copy; veri değerleri Türkçe kalır, görüntü adları İngilizce:
  aday=Lead, arastirildi=Researched, taslak=Draft, onay-bekliyor=Pending approval, gonderildi=Sent,
  cevap=Replied, randevu=Meeting, red=Rejected, pas=Passed).
- **Filtre UI sol panelde OLMAYACAK** (stili de beğenilmedi): header altı kompakt Linear-tarzı
  chip/token şeridi + "+ Filter" popover + saved-view dropdown. Sol grafik panelinde sadece
  fizik + lejant/istatistik.
- **Kod modüllere bölünür** — arkadaşlar bölge sahipliğiyle çalışabilsin:
  - `server/modules/{network,reach,gathering}/` (route+servis; `server/lib/` çekirdek: vault,
    slug, git, config), `server/index.mjs` sadece bootstrap+mount.
  - `web/src/core/` (api client, theme, router, layout: sidebar+copilot çekmecesi) +
    `web/src/modules/{network,reach,gathering}/` (görünümler, bileşenler).
  - `docs/CONTRIBUTING.md`: dev kurulumu, modül sahipliği, PR akışı (GitHub public repo:
    tunapro1234/outpost; deploy bu sunucudan).
- **Git remotes**: `origin` = gitea (iç), `github` = public. Her push iki remote'a.
  `workspaces/` (veri) ve gerçek-veri screenshot'ları gitignore'da — kişisel veri public repoya
  ASLA girmez.

## 7. Değişmezler (tekrar)
İnsan onaysız mail yok · kendi relay'den probe yok · login'li scraping yok · /srv/probot salt-okur ·
secrets repoya girmez · scrape düşük rate/polite.
