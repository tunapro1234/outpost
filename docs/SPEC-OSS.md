# SPEC-OSS — açık kaynak / self-host hazırlığı (2026-07-16)

Tuna: "projeyi güzelleştir; readmeler, contribution, license (GPLv3, Tuna Gül); insanlar kendi
bilgisayarına indirip kurup serve edebilsin; npm tatlı olurdu ama curl da yeter; abartma."

## Karar: hedef kurulum deneyimi (KONTRAT — README bununla birebir aynı olacak)

```bash
git clone https://github.com/tunapro1234/outpost.git
cd outpost
npm install        # server + web bağımlılıklarını da kurar (postinstall)
npm start          # web build (yoksa) + server → http://localhost:3002
```
Tek satır: `curl -fsSL https://raw.githubusercontent.com/tunapro1234/outpost/main/scripts/install.sh | bash`
(script: gereksinim kontrolü Node>=22 + git → clone → npm install → npm start yönlendirmesi.
 systemd kurulumu YOK; o deploy/DEPLOY.md'de kalır. Abartısız.)

## Yerel varsayılanlar (portability)
- `OUTPOST_WORKSPACES` verilmemişse: `./data/workspaces` (repo-içi, gitignore'lu). İlk açılışta
  hiç workspace yoksa `example-vault`'tan `demo` workspace'i otomatik tohumla (kopya; log'a yaz).
- `OUTPOST_PORT` default 3002; `OUTPOST_USERS`/`OUTPOST_HTPASSWD` yoksa profil/şifre uçları
  "not configured" ile zarif kapanır (crash yok).
- Opsiyonel entegrasyonlar yoksa SESSİZ ve zarif düşer (mevcut davranış korunur/tamamlanır):
  mail (maildir yok → boş + warn bir kere), copilot (claude yok → UI'da anlaşılır mesaj),
  gather browser (ws://127.0.0.1:3333 yok → run başlatılınca anlaşılır hata, servis çökmez).
- `.env.example`: tüm OUTPOST_* değişkenleri tek tek açıklamalı.

## Dosyalar
- `LICENSE` — GPLv3 tam metin (eklendi). Telif satırı: README altbilgisi
  "Copyright (C) 2026 Tuna Gül" + package.json `"license": "GPL-3.0-only"`, `"author": "Tuna Gül"`.
- `README.md` — İngilizce, açık-kaynak standardı: ne/neden, özellikler, quickstart (yukarıdaki
  kontrat), mimari özeti (server modülleri + web modülleri haritası), konfig tablosu (OUTPOST_*),
  values/kurallar (insan onaysız mail yok vb.), docs/ index'ine link, lisans bölümü.
- `CONTRIBUTING.md` — İngilizce: dev setup, modül haritası (zone başına klasör), test şartı
  (npm test yeşil), PR akışı, stil (mevcut koda uy), spec-first gelenek (docs/SPEC-*.md).
- `docs/README.md` — spec index'i (hangisi ne, hangi sırayla okunur; Türkçe kalabilir).
- `docs/SPEC-V3.md` içindeki düz-metin default şifre satırı kaldırılır (public repo hijyeni).

## Temizlik
- `scraper/out/`, `scraper/node_modules` tracked ise gitignore + git rm --cached.
- Kök `.gitignore`'a `data/` zaten var; `scripts/` klasörü eklenir (install.sh).
- Ölü/eski dosya taraması: web/mock kalıntıları, kullanılmayan export'lar (review bulgularına göre).
