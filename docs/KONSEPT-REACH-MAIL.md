# KONSEPT — Reach'i agent-native mail olarak yeniden hayal etmek (taslak, Tuna ile tartışılacak)

Tuna'nın brief'i: "Gmail çakması değil. Sistem seni tanısın, ne yapmak istediğini bilsin,
kime ne yazmanın en uygun olduğuna o karar versin. Maili agent'larla baştan hayal edelim."

## Çekirdek fikir: posta kutusu değil, İLİŞKİ AKIŞI

Gmail'in birimi "mesaj"dır; bizim birimimiz **ilişki**. Reach'in ana ekranı gelen kutusu değil,
"bugün dokunmaya değer ilişkiler" akışı olur. Mail, bir ilişkinin içindeki olaylardan sadece biri.

### 1. Ana ekran: "Bugün" akışı (inbox yerine)
Sistem her sabah senin adına bir gündem kurar:
- **Yazılmayı bekleyenler** — skor sırasıyla, her biri "neden şimdi" tek cümlesiyle
  (ör. "dün siteyi yeniledi", "Boğaziçi mezunu, taraması yeni bitti").
- **Cevap gelenler** — ama ham mail değil: agent'ın özeti + önerilen sonraki hamle
  ("olumlu, toplantı istiyor → takvim önerisi taslağı hazır").
- **Sessiz kalanlar** — follow-up taslağı hazır bekleyenler.
- **Bugün vazgeçilecekler** — 2 follow-up bitti; nazik kapanış önerisi.
Her kartta tek tuş: Onayla / Düzenle / Ertele / Bırak. Amaç: sabah 10 dakikada tüm outreach.

### 2. İlişki dosyası (thread yerine dossier — Hermes raporuyla uyumlu)
Bir kişiye tıklayınca mail zinciri değil İLİŞKİ görünür: kim, neden önemli, hangi hook'lar,
şimdiye kadarki tüm temaslar (mail + ileride LinkedIn/telefon notu) tek zaman çizgisinde,
agent'ın "sıradaki en iyi hamle" önerisi ve gerekçesi. Ham mailler istenirse açılır ama
varsayılan görünüm damıtılmış ilişki durumudur.

### 3. Sistem seni tanır (asistan altyapısının üstüne)
- Kişisel asistanın (outpost-user-*) mail tercihlerini biriktirir: tonun, imzan, hangi tür
  kurumlara öncelik verdiğin, hangi saatte yazmayı sevdiğin, hangi varyant tiplerini seçtiğin.
- Writer her taslakta bu profili kullanır; sen varyant seçtikçe/düzenledikçe profil öğrenir
  (memory-curator batch'i haftalık damıtır — otomatik değil, sana diff gösterir).
- "Bugün" akışının sıralaması da profiline göre kişiselleşir (ör. Tuna sabah kurumsal,
  akşam atölye sever → gündem ona göre dizilir).

### 4. Agent'lar akışın İÇİNDE görünür
Her kartta o işi hangi agent'ın hazırladığı ve ne yaptığı görünür (deepener → writer →
evaluator zinciri, tıklanınca kanıt/kaynaklar). Güven böyle kurulur: sistem "bana güven"
demez, "işte kaynaklarım" der.

### 5. Gönderim (değişmez kural korunarak)
Onay → outbox-ready → (senin kararınla kurulacak dispatch: server-mail SMTP + Sent'e IMAP
append). Cevap ingest'i zaten çalışıyor; cevap gelince ilgili ilişki kartı "Bugün" akışına düşer.

## Tuna'ya sorular (implementasyona bunlarla başlarız)
1. "Bugün" akışı Reach'in AÇILIŞ ekranı mı olsun, yoksa Sent/Inbound/Candidates sekmeleri de kalsın mı?
2. Cevap gelen maillerde ham metin mi önde olsun, agent özeti mi? (önerim: özet önde, ham tık ile)
3. Evaluator (taslak onaya düşmeden kalite hakemi) ekleyelim mi — taslak başına ~10 sn gecikme ekler?
4. Günlük gündem push'u ister misin (ör. sabah 08:00 WhatsApp/bp üzerinden "bugün 6 iş var")?
5. Dispatch kararı: server-mail SMTP + IMAP append planına onay veriyor musun, hangi hesaptan (hello@? tuna@?)
