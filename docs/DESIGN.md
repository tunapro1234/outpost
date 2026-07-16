# Outpost — Tasarım (taslak v0.2, 2026-07-16)

> v0.2: probot-business-outreach devri işlendi (HANDOFF.md + research/veri-toplama-yontemleri.md).
> Keşif kaynakları, mail doğrulama katmanı ve KVKK notu eklendi; S1/S4 açık soruları cevaplandı.

Outpost = probot içinde geliştirilen outreach tooling'inin ("/srv/probot/outreach" + business/research)
**standalone, proje-bağımsız** bir araca dönüştürülmüş hali. Probot ilk müşteri; araç herhangi bir
"X'e ulaşmak istiyorum" kampanyasına kurulabilir olmalı.

> Durum: TASLAK. Büyük mimari kararlar Tuna onayına sunulacak (aşağıda "Açık sorular").

## 1. Kapsam

Uçtan uca cold-outreach döngüsü:

1. **Keşif** — hedef kurum/kişi listesi çıkarma (web araştırması, dizinler, Instagram/harita taraması).
2. **Derinleştirme** — kurum profili, kişi keşfi, mail keşfi, kişiselleştirme "kancası" üretimi.
3. **Skorlama & önceliklendirme** — kampanyaya göre parametrik skor formülü.
4. **Taslak & onay** — kişiselleştirilmiş mail taslağı; **insan onayı olmadan gönderim YOK** (değişmez kural).
5. **Gönderim & takip** — SMTP gönderimi, gelen kutu izleme, follow-up hatırlatmaları, cevap loglama.
6. **Görünürlük** — panel/rapor (bugünkü admin outreach paneli muadili) + Obsidian graph.

Kapsam DIŞI (şimdilik): WhatsApp otomasyonu (taslak üretimi var, gönderim yok), CRM entegrasyonu,
toplu şablon patlatma (bilinçli olarak yok — kişiselleştirme ilkesi).

## 2. Mimari önerisi (Tuna onayı bekliyor)

**CLI-first + küçük daemon.** `bp` modelinin outreach karşılığı:

- **`outpost` CLI** — pipeline adımlarını çalıştırır: `outpost bootstrap`, `outpost research <kurum>`,
  `outpost draft <kurum>`, `outpost panel`, `outpost status`. Agent'lar (Claude/codex) bu CLI'ı çağırır;
  CLI, agent olmadan da elle çalıştırılabilir.
- **`outpost-watch` daemon (systemd)** — bugünkü hooks'un muadili: gelen kutu izleme, follow-up
  zamanlayıcı. Mail geldiğinde ilgili agent'a/kanala bildirim (bp msg / WhatsApp köprüsü).
- **Scraper modülü (Node)** — `/srv/outpost/scraper`: Playwright + playwright-extra + stealth,
  **headful Chromium, Xvfb altında**, insan-hızı davranış + düşük rate. Browserbase YOK (karar).
  CLI'dan `outpost research` bunu alt-proses olarak kullanır. Sunucu IP'si residential — avantaj.
- **Kampanya config'i** — `outpost.yaml`: gönderen kimliği/imza, mail altyapısı (SMTP/sendmail komutu),
  vault yolu, skor formülü, durum akışı, ton/kural dosyaları. Probot'a özgü her şey (domain, imza,
  probotstudio adresleri) koddan çıkıp config'e iner.

Dil: pipeline/CLI Python (mevcut scriptlerin devamı, taşıması ucuz), scraper Node (Playwright ekosistemi).
Tek repo, iki paket.

## 3. Veri modeli

**Kaynak-of-truth: markdown vault (Obsidian uyumlu), git'li.** Bugünkü şema (v1) genelleştirilerek korunur:

- `kurumlar/` → hedef org'lar; `kisiler/`; `okullar/` → jenerik "bağ düğümü" (mezuniyet ağları);
  `kanallar/` → karşılaşma yerleri (yarışma/fuar/dernek/topluluk).
- Frontmatter alanları (tip, kategori, skor, durum, mail, mail-kaynak, kanca, yakinlik 0-5...)
  aynen taşınır; kampanyaya özgü alanlar config'de tanımlanır.
- Kenarlar wikilink'lerden (`## İlişkiler`), mail trafiği kişi notunda `## Mailler`.
- Türetilmiş görünümler (panel data.json, graph analysis) vault'tan build edilir — vault tek gerçek.

CSV'ler (skor listeleri, mail listeleri) **girdi/çıktı formatı** olarak kalır, kalıcı depo olmaz.
SQLite'a geçiş şimdilik önerilmiyor: vault + git, agent-dostu ve Tuna'nın Obsidian akışıyla uyumlu.

## 4. Playwright araştırma agent'ının yeri

- **Browser = merkezi paylaşımlı sunucu** (2026-07-16, ada kurdu; Tuna kararı "playwright ayrı
  server olsun"): Outpost KENDİ Chromium'unu kurmaz, `chromium.connect('ws://127.0.0.1:3333/<TOKEN>')`
  ile bağlanır (token: `/srv/browser/.ws_token`, asla commit/log edilmez; detay /srv/browser/CLAUDE.md).
  Headful (xvfb) + custom arg destekli. İş bitince `browser.close()`.
- `scraper/` içinde iki katman:
  - **primitives**: `fetch-page`, `screenshot`, `search-and-extract` gibi tekil komutlar (CLI/JSON çıktı) —
    codex/Claude subagent'ları bunları çağırır.
  - **görev scriptleri**: Instagram profil özeti (login'siz), site tarama (iletişim/hakkında sayfaları),
    harita dizin taraması gibi tekrar eden akışlar.
- Anti-bot duruşu: headful (sunucu xvfb sağlıyor), insan-hızı gecikmeler (2-5sn), düşük rate,
  tek residential IP (188.3.36.176) — IP tutarlılığı dönen proxy'den daha kritik (araştırma bulgusu).
- Etik/risk sınırı: login gerektiren scraping ve SMTP/RCPT probe YASAK (mevcut server-main direktifi
  devralınır).

## 5. Taşıma stratejisi (envanterle netleşecek)

- **Olduğu gibi taşınır**: vault şeması, pipeline akışı (bootstrap → fan-out → link temizliği →
  panel), hooks mantığı (inbox/followup izleme), skor yaklaşımı.
- **Genelleştirilerek yeniden yazılır**: scriptlerdeki sabit yollar/domainler → config; mail gönderimi
  (docker-mailserver'a sıkı bağlı) → SMTP soyutlaması; panel build → jenerik.
- **Probot'ta kalır (taşınmaz)**: probot vault İÇERİĞİ, kurum profilleri, taslaklar, gönderim geçmişi.
  Outpost olgunlaşınca probot-outreach bunun ilk kullanıcı kurulumu olur (veri migrate edilir, o gün).

## 6. Açık sorular (Tuna'ya)

1. CLI+daemon mimarisi onayı (alternatif: tam servis/web-app — önerilmiyor, ağır).
2. Vault-as-source-of-truth devam mı, DB'ye geçiş mi? (Önerim: vault.)
3. Probot verisinin migrate zamanı: Outpost hazır olana kadar probot-business-outreach mevcut
  düzende mi devam ediyor? (Varsayımım: evet, ben sadece okurum.)
4. Instagram gibi login isteyen kaynaklar: login'li scraping istiyor muyuz, istiyorsak hangi hesapla?
5. Outpost başka kampanyalarda da kullanılacak mı yakında (kitap? impact?) — genelleştirme derinliğini belirler.
