# Outpost scraper

Bu modül yerel Chromium kurmaz veya başlatmaz. Playwright istemcisi, çalışma
anında `/srv/browser/.ws_token` dosyasındaki token ile merkezi browser
sunucusuna bağlanır. Tam WebSocket adresi gerektiğinde `BROWSER_WS` ortam
değişkeniyle override edilebilir. Token'ı loglamayın, koda yazmayın ve repoya
eklemeyin.

## Kurulum

```sh
cd /srv/outpost/outpost/scraper
export npm_config_cache=/srv/outpost/.npm-cache
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm install
```

Playwright sürümü merkezi sunucuyla uyum için `1.61.1` olarak sabitlenmiştir.
`playwright install` çalıştırmayın; yerel Chromium indirmeyin.

## Kullanım

Bir sayfanın başlık, ilk 5000 karakterlik metin ve bağlantılarını JSON olarak
almak, ayrıca `out/<slug>.png` ekran görüntüsünü oluşturmak için:

```sh
node fetch.mjs https://example.com
```

Merkezi browser ve iki dış siteyle smoke testi çalıştırmak için:

```sh
node smoke.mjs
```

Smoke çıktısı Sannysoft bot testlerinin `passed` ve `failed` listelerini,
Hacker News başlığını ve son satırda `SMOKE OK` veya hata nedenini içerir.

## Kurallar

- Login veya oturum gerektiren sayfalarda scraping yapmayın.
- SMTP probe, adres doğrulama veya mail gönderimi yapmayın.
- Düşük istek hızını koruyun; istekler arasında insan hızında bekleyin.
- Site kullanım koşullarına ve `robots.txt` kurallarına uyun.
- Her iş sonunda browser bağlantısını kapatın.
