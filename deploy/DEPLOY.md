# Outpost Deploy (outpost.trasumanar.ai)

Durum (2026-07-16, outpost-main): DNS + SSL + nginx HAZIR, systemd unit bu dizinde.

## Yapılanlar
1. **DNS**: gerek yoktu — `*.trasumanar.ai` wildcard A kaydı zaten sunucuya işaret ediyor.
2. **Basic auth**: `/etc/nginx/.htpasswd-outpost` (kullanıcı `tuna`; parola `/srv/outpost/.web-auth.txt`,
   chmod 600, repo dışı). Veri kişisel iletişim içerdiği için (KVKK) site auth'suz açılmaz.
3. **nginx**: `/etc/nginx/sites-available/outpost.trasumanar.ai.conf` (enabled) → proxy 127.0.0.1:3002.
4. **SSL**: certbot (`certbot --nginx -d outpost.trasumanar.ai`), otomatik yenilenir.
5. **Port**: 3002, `/srv/docs/ports.md`'ye kayıtlı.

## Servis kurulumu (server/ implement edilince)
```
cp deploy/outpost.service /etc/systemd/system/outpost.service
systemctl daemon-reload && systemctl enable --now outpost
curl -s http://127.0.0.1:3002/healthz
```

## Veri
Canlı vault: `/srv/outpost/data/vault` (repo dışı). İlk dolum: probot outreach vault'undan snapshot import:
```
node server/importer.mjs /srv/probot/outreach/vault /srv/outpost/data/vault
```
Kaynak vault salt-okunur; kanonik veri migrate gününe kadar probot'ta kalır (HANDOFF).
