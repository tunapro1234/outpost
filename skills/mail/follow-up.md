# follow-up — cevapsıza takip ritmi

Follow-up taslak ÜRETİR, GÖNDERMEZ — her takip de onay kuyruğuna düşer. Amaç yine satış değil,
kolay bir "evet/hayır" veya doğru kişiye yönlendirme almak.

## Ritim (kanonik — DEĞİŞMEZ)
- **Gün 0:** ilk mail (`cold-intro.md`) gönderilir.
- **Son gönderimden +4 gün:** ilk takip (`followup_1`) — yani ilk mailden 4 gün sonra (≈gün 4).
  Aynı thread'de kısa "Re:", 2–4 cümle.
- **followup_1'den +5 gün:** ikinci ve SON takip (`followup_2`) — yani ≈gün 9. Nazik kapanış.
- **Referans çerçevesi (otomasyon için net):** her iki pencere de bir ÖNCEKİ gönderime
  (`last_mail_at`) göre ölçülür — sabit başlangıç tarihine değil. "+4" ve "+5" birer aralıktır,
  ard arda toplanır (0 → +4 → +9), takvim gününe sabitlenmez.
- Sonrası `closed`. **Toplam en fazla 3 mail. ASLA 2'den fazla takip.**
- Yanıt / ret / "yazmayın" gelirse sekans O AN durur (`replied` veya `closed`), sonraki taslak
  üretilmez.

## Genel kurallar
- Aynı maili tekrar gönderme.
- İlk takip aynı mail zincirinde ("Re:" — bu GERÇEK bir devam olduğu için sahte Re: değil).
- İkinci takip yeni bir değer/açı ya da eşik düşürme taşısın; sadece "hatırlatma" olmasın.
- Kısa: 2–4 cümle yeter.
- Kurumsal yönetici, eğitimci ve kamu yetkilisine sınav/kayıt/dönem başı gibi yoğun dönemde
  ve art arda günlerde takip YOK.

## ⛔ Yasak ton
- "Dönüş alamadım." / "Mailimi gördünüz mü?" / "Neden cevap vermediniz?"
- "Son kez yazıyorum" deyip sonra yine yazmak.
- Suçlayıcı, sitemli, mahcup-agresif her şey.
- Yapay aciliyet, "fırsat kaçıyor".
Tercih: suçlamadan bağlam ekle, eşiği düşür, kolay çıkış sun.

## followup_1 — Gün +4 (kısa Re, yeni bir somut kanca)
Yapı: nazik giriş → önceki maile TEK somut ekleme (yeni soru / neyi anlamaya çalıştığın) →
düşük baskılı CTA.

İyi örnek:
```
Konu: Re: Probot — İz Atölye için 15 dakika

Merhaba Adem Bey,

Önceki mailime kısa bir şey eklemek istedim. Görüşmede özellikle yedek parça bekleme süresini
anlamaya çalışıyoruz.

Size uygun bir vakitte 15 dakika konuşmamız mümkün olur mu?
```
Neden iyi: sitem yok, TEK yeni somut kanca var (yedek parça bekleme süresi — "tek somut ekleme"
kuralına uygun; ikinci bir konu açılmıyor), tek CTA, kısa.

## followup_2 — Gün +5 (son, nazik kapanış)
Yapı: baskıyı tamamen kaldır → eşiği düşür (ziyaret yerine iki görsel / kısa bilgi) VEYA doğru
kişiyi sor → sitemsiz, mahcup ama özür dizisine girmeyen ton (kendini küçültme değil, nazik
kapanış) → dosyayı kendin kapatmayı öner.

İyi örnek A (eşik düşürme):
```
Konu: Re: Probot — İz Atölye için 15 dakika

Merhaba Adem Bey,

Sanırım zamanı denk gelmedi, sorun değil — ısrar etmek istemem. Ziyaret yerine ürünün ne
aşamada olduğunu anlatan iki kısa görseli iletmem daha kolaysa öyle de ilerleyebilirim.

Bu şekilde devam edelim mi, yoksa şimdilik kapatayım mı? Ne olursa olsun ilginiz için teşekkürler.
```

İyi örnek B (doğru kişiyi sorma):
```
Merhaba Adem Bey,

Sanırım denk gelmedi, sorun değil. Bu konuyu atölyenizde konuşmam gereken daha doğru biri varsa
adını paylaşabilirseniz sevinirim; değilse konuyu şimdilik kapatıyorum.

Vakit ayırdığınız için teşekkürler.
```
Neden iyi: baskı sıfır, alıcıya "kapatabilirsin" izni veriyor, mahcup ama sitemsiz, kolay çıkış.

## Kötü örnek (ne followup_2 ne de hiçbir yerde)
```
Merhaba Adem Bey, iki kez yazdım ama dönüş alamadım. Son kez soruyorum: bu ürünle ilgileniyor
musunuz, ilgilenmiyor musunuz? Cevap bekliyorum.
```
Neden kötü: sitem, sayaç sayma ("iki kez yazdım"), ültimatom tonu, baskı, kolay hayır yok.

## Durum makinesi (frontmatter ile uyumlu)
`none → drafted → approved → sent → (cevap yoksa) followup_1 → followup_2 → closed`.
Herhangi bir yanıt/ret → `replied`/`closed`, sekans durur. `mails_sent` ve `last_mail_at`
GÖNDERİM anında (`sent`) güncellenir — taslak üretilirken DEĞİL. Aksi halde takip sayacı,
onay/gönderim daha gerçekleşmeden başlar ve +4 / +5 pencereleri erkene kayar. Pencereler
`last_mail_at`'e (son GERÇEK gönderim zamanı) göre hesaplanır.
