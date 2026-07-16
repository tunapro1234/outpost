# Outpost — doküman / spec index'i

Outpost spec-first geliştirilir: bir zone'a dokunmadan önce ilgili SPEC okunur. Aşağıdaki liste
hangi dosyanın ne anlattığını ve **güncel mi / tarihsel mi** olduğunu gösterir. Yeni başlıyorsan
`DESIGN.md` → `SPEC.md` → `SPEC-V3.md` sırasıyla oku.

## Temel / mimari

- **`DESIGN.md`** — genel tasarım taslağı: neden graf-merkezli, keşif kaynakları, veri modeli.
  *Güncel (yaşayan tasarım notu).*
- **`SPEC.md`** — v1 çekirdek sözleşme: vault = markdown, sunucu parse + graf + REST + UI serve.
  *Güncel temel; V3 bunun üstüne bina eder.*

## Güncel durum (bugünkü ürün)

- **`SPEC-V3.md`** — ürün mimarisi: üç bölge (Gathering / Network / Reach), yan panel navigasyon,
  workspace kavramı. *Güncel ana referans.*
- **`SPEC-GATHER2.md`** — Gather v2 taksonomisi (Discover People) + Copilot tmux köprüsü.
  *Güncel.*
- **`SPEC-OVERVIEW.md`** — Overview / dashboard sayfası (durumu tek bakışta). *Güncel.*
- **`SPEC-MAIL.md`** — probotstudio mail ingest (SADECE OKUMA; Outpost mail göndermez). *Güncel.*
- **`SPEC-FILTER.md`** — Network filtre UX'i (V3a): tek `queryState`, Graph+List aynı sorgu,
  Filter / Highlight / Focus. *Güncel.*

## Tarihsel katman (UI evrimi — referans)

- **`SPEC-UI.md`** — UI v1 sözleşmesi (graf merkezde, ilk sürüm). *Tarihsel; V2/V3 ile aşıldı.*
- **`SPEC-UI-V2.md`** — UI v2 (Tuna steer'i: tema/dark, layout revizyonları). *Tarihsel; V3'e
  giden ara adım.*

## Süreç / self-host

- **`SPEC-OSS.md`** — açık kaynak / self-host hazırlığı: kurulum kontratı, lisans, doküman işleri.
  *Güncel (bu index de buradan doğdu).*
