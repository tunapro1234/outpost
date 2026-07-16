# SPEC-MAIL — probotstudio mail ingest (SADECE OKUMA) (2026-07-16)

DEĞİŞMEZ KURAL: Outpost mail GÖNDERMEZ. Bu modülde SMTP/submission/gönderim kodu OLMAYACAK.
Tuna'nın açık onayı olmadan gönderim özelliği hiçbir zaman eklenmez. systemd unit'te maildir
BindReadOnlyPaths ile ro-mount (yapısal garanti).

## Kaynaklar (env)
- `OUTPOST_MAIL_DATA` (default `/srv/mailserver/data/probotstudio.com`) — dovecot maildir kökü:
  `<user>/{cur,new}` = Inbox, `<user>/.Sent/{cur,new}` = Sent. Kullanıcılar: ada, admin, cem,
  elif, hello, huseyin, info, no-reply, sales, tuna, yigit (dinamik listele, hardcode etme).
- `OUTPOST_MAIL_LOG` (default `/srv/mailserver/logs/mail.log`) — postfix log (v1'de opsiyonel,
  kullanılmayabilir).

## Modül: server/modules/mail/
- Maildir dosyalarından SADECE header parse (From, To, Cc, Subject, Date, Message-ID) — kendi
  hafif parser'ımız (yeni npm bağımlılığı ekleme). Gövde v1'de yok.
- Normalize kayıt: `{ id: <message-id|hash>, account, direction: "sent"|"received", peer:
  [adresler], subject, date (ISO), folder }` → workspace `mails/ingested.jsonl` (append,
  message-id+account dedup; tam yeniden tarama idempotent olmalı).
- Eşleştirme: peer adresini vault entity'lerinin mail/mails alanlarıyla eşle (network service).
  Mevcut mails modülü/endpoint'i entity Mails sekmesi + Reach "Sent" için `log.jsonl` okuyorsa,
  servis katmanında `ingested.jsonl` ile birleştir (UI değişikliği gerekmez; API şeması korunur).
- Overview metrics (server/modules/overview) outreach sayılarını birleşik kaynaktan alır
  (direction=sent kayıtlar mailsSent'e sayılır).
- Tarama: server start + 10 dk'da bir interval + `POST /api/ws/:ws/mail/refresh` (manuel).
  Maildir okunamıyorsa (izin/yol yok) sessizce boş — servis çökmez, log'a warn.
- Test: fixture maildir ile parse+dedup+merge testleri.
