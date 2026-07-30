---
name: outpost-ui
description: Tuna'nın açık Outpost sekmesini terminalden kontrol et — sayfa/entity aç, network/görünüm/filtre/renk modu değiştir, toast göster, temas/araştırma durumu kaydet, ya da özel HTML rapor sayfası üretip sekmede aç. "Outpost'ta göster", "haritayı renklendir", "şu listeyi aç", "X'e yazdım, kaydet" gibi işlerde kullan.
---

# Outpost arayüzünü sürme

Outpost (op.probotstudio.com) Tuna'nın iş-network arayüzü; prod servis `127.0.0.1:3002`.
Tarayıcıdaki açık sekme SSE ile bağlıdır: sen localhost'a POST atarsın, komut onun TÜM açık
oturumlarına anında gider ve ekranda küçük bir "agent: ..." toast'ı ile görünür.

## Komut gönderme

```bash
curl -s -X POST localhost:3002/api/control/command \
  -H 'Content-Type: application/json' -H 'X-Remote-User: tuna' \
  -d '{"action":"navigate","path":"/network"}'
```

Cevap `{"delivered":N}`. **`delivered:0` hata değildir** — Tuna'nın sekmesi açık değil demektir;
bunu söyle, komutu tekrar tekrar atma.

## Aksiyonlar

| action | payload | ne yapar |
|---|---|---|
| `navigate` | `{path}` | Sekmeyi o path'e götürür (aşağıdaki path listesi) |
| `open-entity` | `{id, ws?}` | Entity panelini açar (id = slug, örn. `hasan-bilgin`) |
| `set-workspace` | `{ws}` | Workspace değiştirir (`probot`) |
| `set-network` | `{network}` | `warm` (Tuna'nın ağı, UI default) / `research` / `intel` |
| `set-view` | `{view}` | `graph` veya `list` |
| `set-filters` | `{q?, type?, tag?, state?, preset?}` | Filtre kurar. `preset` = kayıtlı "Saved view" ADI; hazır tip listeleri için bunun yerine `navigate` ile `/lists/...` kullan |
| `set-color-mode` | `{mode}` | Graf rengi: `type` (tip) / `state` (0-5 temas durumu) |
| `set-theme` | `{theme}` | Tema |
| `toast` | `{message}` | Ekranda kısa mesaj |

Faydalı path'ler: `/overview`, `/network`, `/mail`, `/agents`,
`/lists/schools` (Okullar), `/lists/institutions` (Kurumlar), `/lists/teams` (Takımlar),
`/lists/teachers` (Öğretmenler), `/lists/competitors` (Rakipler),
`/api/ws/probot/pages/<dosya>.html` (senin ürettiğin özel sayfa).

State skalası (0-5): 0 sadece bilgi · 1 mesaj atılabilir · 2 mesaj atılmış · 3 cevap alınmış ·
4 görüşme bekliyor · 5 görüşme yapılmış. Ayrıca `flags.no_contact` (temas-yasak; ASLA mesaj
önerme) ve `flags.internal` (kendi ekibimiz) vardır.

Örnek — "cevap almış olduklarımı haritada göster":
```bash
C() { curl -s -X POST localhost:3002/api/control/command -H 'Content-Type: application/json' -H 'X-Remote-User: tuna' -d "$1"; }
C '{"action":"set-network","network":"warm"}'
C '{"action":"set-view","view":"graph"}'
C '{"action":"set-color-mode","mode":"state"}'
C '{"action":"toast","message":"Yeşiller = cevap alınmış (3)"}'
```

## Karar: filtre mi, özel sayfa mı?

1. **Önce mevcut arayüz.** İstenen şey bir liste, graf kesiti veya entity ise `navigate` +
   `set-*` yeter: ucuz, anında, arayüzle tutarlı.
2. **Özel HTML sayfa** SADECE mevcut görünümlerin karşılayamadığı sunum için (özel rapor,
   karşılaştırma tablosu, farklı grafik türü):
   - Veriyi API'den al (aşağıda), tek dosyalık bağımsız HTML üret (CDN yok, koyu tema, başlığa
     tarih+kaynak yaz).
   - `/srv/outpost/workspaces/probot/pages/<konu>.html` olarak kaydet (dizin yoksa oluştur;
     kebab-case ad; bunlar tek seferlik görünümlerdir, üzerine yazmak serbest).
   - Aç: `{"action":"navigate","path":"/api/ws/probot/pages/<konu>.html"}`.
   - Sadece .html/.css/.js/.png/.svg servis edilir; path traversal engellidir.

## Veri API'leri (okuma; hepsi `-H 'X-Remote-User: tuna'` ile)

- `GET localhost:3002/api/ws/probot/networks` — network listesi
- `GET localhost:3002/api/ws/probot/graph?network=warm` — graf; config'de gizli node'lar
  (örn. probot hub'ı) çıkarılmış gelir, `include_hidden=1` ile dahil olur
- `GET localhost:3002/api/ws/probot/status-map?network=warm` — entity başına {state, research_status}
- `GET localhost:3002/api/ws/probot/entity/<id>/interactions` — temas kayıtları

## Yazma: temas ve araştırma durumu

Tuna "X'e WhatsApp'tan yazdım" derse temas kaydet (kanal: whatsapp/mail/telefon/yuzyuze/diger):
```bash
curl -s -X POST localhost:3002/api/ws/probot/entity/<id>/interactions \
  -H 'Content-Type: application/json' -H 'X-Remote-User: tuna' \
  -d '{"channel":"whatsapp","direction":"out","note":"kısa not"}'
```
Bir kişi/kurum üzerinde araştırmaya başlarken `active`, bitirince `done` işaretle — haritada
parlama/outline bundan beslenir:
```bash
curl -s -X PUT localhost:3002/api/ws/probot/entity/<id>/status \
  -H 'Content-Type: application/json' -H 'X-Remote-User: tuna' \
  -d '{"research_status":"active","agent":"<senin-adın>"}'
```

## Sınırlar

- `X-Remote-User: tuna` başlığı şart (yoksa 401).
- Outreach state'ini (0-5) Tuna'nın açık talimatı olmadan DEĞİŞTİRME — o alan onundur; sen
  temas kayıtlarını ve research_status'u işlersin. `no_contact` işaretli kişilere temas önerme.
- Sekmeyi arka arkaya komutla zıplatma; bir istek = bir görünüm-değişikliği zinciri, sonuna
  kısa bir `toast` ekle ki ne yaptığın belli olsun.
- Mail göndermek bu skill'in dışındadır (Outpost mailer onay düzeni geçerli).
- Dev ortamı test için: aynı API `127.0.0.1:3003` / https://outpost-dev.tunapro.xyz.
