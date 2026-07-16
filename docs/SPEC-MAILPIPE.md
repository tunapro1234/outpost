# SPEC-MAILPIPE — mail üretim hattı + skorlama + onay (2026-07-16 gecesi)

Tuna'nın gece brief'inden (goal). DEĞİŞMEZ: **onay olmadan mail GÖNDERİLMEZ** — bu hat yalnız
taslak üretir; onaylanan taslak "outbox-ready" olur, fiziksel gönderim ayrı karar.

## Roadmap (gece → sonrası)
1. (bu gece) Probot mail asset'leri + YC/best-practice araştırması → `skills/mail/` skill seti.
2. (bu gece) Skor motoru + `GET /api/ws/:ws/mailqueue`.
3. (bu gece) person-deepener agent + A*-vari tarama politikası.
4. (bu gece) mail-writer agent → stage `kind: mail-draft` (3 varyant + gerekçe).
5. (bu gece) Overview "Mails awaiting approval" bölümü + Reach draft onayı; follow-up motoru (taslak üretir).
6. (bu gece) Probot döngüsü açık; outpost-main 30 dk'da bir denetler.
7. (sonra) LinkedIn: Tuna pro hesap → merkezi playwright scrape (hesap gelince).
8. (sonra) Gerçek gönderim mekanizması (Tuna ile; server-mail üzerinden, Sent'e IMAP append şartı).

## Agent seti (5 — şimdilik sabit)
company-scout (şirket genişletici) · site-scanner (şirket derinleştirici) ·
people-finder (insan genişletici) · **person-deepener (YENİ)** · **mail-writer (YENİ)**.

## Veri modeli (person frontmatter ekleri)
```yaml
scan_state: unscanned | partial | scanned   # default unscanned
scan_depth: 0-3
school: <string|null>
authority: founder|exec|manager|staff|unknown
hooks: ["Boğaziçi mezunu", "FRC mentoru", ...]   # yazılabilir açılar
mail_state: none|drafted|approved|sent|replied|followup_1|followup_2|closed
mails_sent: 0
last_mail_at: null
```
Şirket frontmatter: `importance: 0-100` (yoksa mevcut score, o da yoksa 50).

## Skor (mailqueue sırası)
```
score = 0.40*companyImportance + 0.25*authority + 0.20*depth + 0.15*hookBonus   # 0-100
```
- authority: founder=100, exec=80, manager=60, staff=35, unknown=15 (rol metninden heuristik map).
- depth: scanned=100, partial=50; **unscanned kuyruğa GİRMEZ** → "awaiting scan" listesinde.
- hookBonus: hook başına +34 (cap 100). Avantaj sinyalleri `server/modules/mailer/signals.yaml`:
  okullar (Boğaziçi=güçlü, İTÜ/ODTÜ/GTÜ=orta), FRC/robotik geçmişi, ortak bağlantı ([[wikilink]] komşuluğu).
- Nüans (Tuna): tamamen tarandı ama hook yok → depth tam, hookBonus 0 ("iyi ama çok iyi değil");
  taranmadıysa acil değilse tarama bekler. Skoru API `reasons: []` ile açıklar (her bileşen bir cümle).

## person-deepener tarama politikası (A*-vari, ucuz+yüksek sinyal önce)
Sıra: (1) okul — en ucuz, en ayırt edici; avantajlı okul çıkarsa bütçe x2 derinleş;
(2) rol/yetki doğrulama; (3) hook avı (haber, konuşma, proje, ortak bağ). Her adım sonrası
"devam değer mi?" kararı: expectedGain = şirketImportance × kalanBilinmezlik − adımMaliyeti;
eşik altında dur, scan_state=scanned yaz. Kaynaklar: site/takım sayfası, web araması (luna),
(ileride linkedin). Sonuçlar person frontmatter'ına stage-onay AKIŞI OLMADAN yazılMAZ —
deepener bulguları da stage'e `kind: enrich` önerisi olarak düşer (insan onayı korunur).
İstisna: scan_state/scan_depth meta alanları (veri değil süreç durumu) doğrudan yazılabilir.

## mail-writer
- Girdi: mailqueue başı; kural: aynı şirketten aynı anda tek kişi (in-flight draft/approved varken
  o şirketten yenisi yazılmaz); mail_state=none olanlar öncelikli.
- Üretim: kişi+şirket bağlam paketi (gpt toplar) → 3 varyant (Opus, `skills/mail/` skill'leriyle;
  ton karşı tarafa göre: kurumsal yönetici / teknik kişi / eğitimci / genç girişimci farklı).
- Her varyant: `subject`, `body`, `rationale` (neden bu açı/ton, hangi hook), `tone` etiketi.
- Çıktı: stage `kind: mail-draft`, meta: person_id, company_id, variants[3], queue_score, reasons.
- Cycle başına en çok 5 kişi, gecede en çok 15 (kalite > hacim).

## Follow-up motoru (taslak üretir, GÖNDERMEZ)
sent + 4 gün cevapsız → followup_1 taslağı ("Re:", kısa nazik hatırlatma); +5 gün → followup_2
(son; "rahatsız ettiysek kusura bakmayın" kapanışlı). Sonrası closed. Follow-up taslakları da
onay kuyruğuna düşer. Target başına sayaç: mails_sent, last_mail_at, mail_state makinesi.

## UI
- Overview: "Mails awaiting approval" bölümü — taslak kartı: kişi/şirket, skor+neden, 3 varyant
  sekmesi, inline düzenleme, Approve/Reject. Approve → mails/outbox.jsonl (approved, GÖNDERİLMEMİŞ).
- Reach: Drafts sekmesi aynı listeye bakar. Gather staging'le aynı bileşen dili.

## Draft onay API kontratı (UI ve writer bunu paylaşır)
- `GET /api/ws/:ws/maildrafts` → `{ drafts: [{ id, person: {id,name}, company: {id,name}, score,
  reasons: [], variants: [{subject, body, rationale, tone}], created_at, followup_stage: 0|1|2,
  status: "pending" }] }` (stage kind=mail-draft kayıtlarından)
- `POST /api/ws/:ws/maildrafts/:id/approve` gövde `{ variant: <idx>, subject?, body? }`
  (düzenlenmiş metin gönderilebilir) → mails/outbox.jsonl'e approved kayıt (GÖNDERİLMEMİŞ),
  person mail_state=approved, stage kaydı kapanır.
- `POST /api/ws/:ws/maildrafts/:id/reject` gövde `{ reason? }` → stage kapanır, mail_state=none.

## Skills
`skills/mail/` (repo): `tone-map.md` (alıcı tipi→ton), `cold-intro.md`, `follow-up.md`,
`subject-lines.md`, `variants.md` (varyantlar nasıl ayrışır + gerekçe formatı).
Kaynak: probot outreach asset'leri (salt-okur tarama) + YC/best-practice web araştırması.
probot'un gerçek bağlamı (ProBot Studio ne satar, kime, referanslar) `skills/mail/context-probot.md`.
