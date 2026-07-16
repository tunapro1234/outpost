# SPEC-CONTROL — terminal agent → canlı UI kontrol kanalı (2026-07-16)

Tuna: "benim bilgisayarımda açık olan instance'ı senin de yönetebilmen lazım; 'şu sayfayı aç'
dediğimde açabilmelisin; terminaldeki AI'larla bağlantılı; dash'i kontrol edebilmelisin."
CLI şimdilik YOK — curl yeter.

## Mimari
Tarayıcı (Tuna'nın açık sekmesi) sunucuya SSE ile bağlanır; terminal agent'lar localhost'a
komut POST'lar; sunucu komutu o KULLANICININ tüm açık oturumlarına yayınlar; web istemci uygular.

## Server: `server/modules/control/`
- `GET /api/control/stream` (SSE): kimlik = X-Remote-User (yoksa OUTPOST_DEFAULT_USER; o da yoksa 401).
  Bağlanan istemci kullanıcı-bazlı kayıt defterine girer; 25 sn'de bir `: ping` heartbeat;
  bağlantı kopunca kayıt silinir. Event formatı: `data: {"id","action",...}\n\n`.
- `POST /api/control/command` (aynı kimlik kuralı): gövde `{ "action": "...", ...params, "target"?: "<user>" }`.
  `target` verilmezse komut gönderen kimliğin oturumlarına gider. `target` verilirse SADECE
  localhost'tan gelen isteklerde kabul edilir (agent'lar sunucuda; dışarıdan hedefli komut yok).
  Dönüş: `{ delivered: <oturum sayısı> }` (0 olabilir — istemci açık değilse).
- Aksiyon allowlist (v1) — başka action 400:
  - `navigate` `{path}` — path `/` ile başlamalı, aynı-origin route (URL değil, path); web router'a gider.
  - `open-entity` `{id, ws?}` — `/e/:id`e gider (ws verilirse önce workspace değiştir).
  - `set-workspace` `{ws}`
  - `set-theme` `{theme: dark|light}`
  - `toast` `{message}` — sadece bildirim göster.
- Komut logu: appendonly `data/control.log.jsonl` benzeri gerek YOK v1'de; fastify log yeter.

## Web: `web/src/core/control.ts` + App entegrasyonu
- Açılışta EventSource `/api/control/stream`; kopunca exponential backoff (1s→30s) ile yeniden bağlan.
- Gelen komut uygulanır (router.navigate, workspace setter, tema setter) ve sağ altta küçük,
  otomatik kaybolan bir toast gösterilir: "⌁ agent: opened /network" tarzı (action + kaynak).
  Toast mevcut tema token'larıyla, mütevazı.
- Güvenlik: yalnız allowlist aksiyonlar; path'ler `/` ile başlayan iç route; URL/history dışına çıkma.

## Agent kullanım örneği (dokümana + memory'e girecek)
```bash
curl -s -X POST localhost:3002/api/control/command \
  -H 'Content-Type: application/json' -H 'X-Remote-User: tuna' \
  -d '{"action":"navigate","path":"/network"}'
```

## Test
- Unit: kayıt defteri, kimlik, allowlist, target=localhost kuralı.
- Canlı: playwright oturumu aç (tuna olarak), curl ile navigate gönder, sayfanın değiştiğini doğrula.
