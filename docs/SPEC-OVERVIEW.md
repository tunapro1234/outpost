# SPEC-OVERVIEW — Dashboard sayfası (2026-07-16)

Tuna steer: yan panelde EN TEPEDE (Network'ten önce) "Overview" sayfası. Amaç: durumu tek
bakışta görmek — kaç kişiye ulaşıldı / kaç günde, günlük mail sayıları vb.

## Backend kontratı

`GET /api/ws/:ws/metrics` →
```json
{
  "totals": { "entities": 1864, "byType": {"person":497,"company":165,"institution":53,"school":448,"channel":701},
              "withMail": 0, "withoutMail": 0 },
  "outreach": {
    "mailsSent": 0, "uniqueRecipients": 0,
    "firstMailAt": "ISO|null", "lastMailAt": "ISO|null",
    "activeDays": 0, "avgPerActiveDay": 0,
    "daily": [{ "date": "2026-07-16", "count": 3 }],   // son 30 gün, boş günler 0
    "byStatus": { "sent": 0, "replied": 0 }             // log'da varsa
  },
  "gather": { "staged": 0, "acceptedTotal": 0, "agents": 4, "running": 0 },
  "reach": { "candidates": 0 }
}
```
Kaynaklar: vault (network service), `mails/log.jsonl`, stage/journal, reach candidates hesabı.
Hepsi mevcut modül servislerinden derlenir; yeni modül `server/modules/overview/` (routes+service+test).

## UI kontratı

- Sidebar üst grubun EN BAŞINA "Overview" (Network'ün üstü). Route: `/` → Overview
  (Network `/network`e taşınır; eski `/` graf linkleri Overview'a düşer — kabul).
- İçerik: KPI kartları (Reached people, Mails sent, Avg/day, Total entities, Staged),
  son 30 gün günlük mail bar grafiği (kütüphanesiz, saf CSS/SVG), tip dağılımı,
  son aktivite listesi (son mailler + son gather run'ları).
- EN dili, dark+white tema, kompakt Linear hissi. 0 console error, build yeşil.

## Mail kuralı (değişmez)

Outpost HİÇBİR koşulda kendiliğinden mail göndermez; gönderim ancak Tuna'nın açık onayıyla,
insan-onaylı akışla olur. Bu spec sadece OKUMA/metrik tarafını kapsar.
