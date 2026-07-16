# subject-lines — konu satırı kuralları ve kalıplar

Konu satırı, gövdenin dürüst özeti ve tıklama tuzağı değil. ProBot kanonu ile genel araştırma
burada aynı yeri gösteriyor: kısa, sakin, alıcının dünyasına referans.

## Kurallar
- **Kısa tut:** marka (Probot) ve kurum/kişi adı DIŞINDAKİ çerçeve 2–4 kelimeyi geçmesin (ör. "… için 15 dakika", "… için kısa soru"). Kurum adı uzunsa toplam satır uzayabilir; yine de tek bakışta okunmalı, gereksiz kelime yok. (Kelime tavanını marka + kurum adına uygulama — kanonik kalıp aksi halde kendi kuralını çiğner.)
- Kurum veya kişi adına referans içersin — jenerik değil.
- Gövdeyi dürüstçe temsil etsin (yanıltma yok).
- **Yasak:** "satış", "kampanya", "fırsat", "ücretsiz", "indirim", "demo", "ASAP", yapay aciliyet.
- **Yasak:** ünlem, emoji, büyük harf bloğu, fiyat/indirim oranı gibi ticari rakamlar, buzzword. (Süre bilgisi "15 dakika" serbest — ricanın çerçevesidir, satış/fiyat rakamı değil.)
- **Yasak:** ilk mailde sahte `Re:` veya `Fwd:`. (Gerçek takipte `Re:` doğaldır — bkz `follow-up.md`.)
- Boş konu veya yalnızca "Merhaba" YOK.
- Kişi adı eklemek iyidir ama kurum adı + somut çerçeve daha güçlüdür.

## Kanonik kalıp (varsayılan)
```
Probot — [Kurum] için 15 dakika
```
Örnek: `Probot — İz Atölye için 15 dakika`

## Alternatif kalıplar (açı/varyanta göre — bkz variants.md)
| Kalıp | Örnek | Ne zaman |
|---|---|---|
| `Probot — [Kurum] için 15 dakika` | `Probot — Esenler Bilim Merkezi için 15 dakika` | Genel keşif, güvenli varsayılan |
| `[Kurum] için kısa soru` | `İz Atölye için kısa soru` | Merak/soru açısı öne çıkıyorsa |
| `[Kurum] deneyiminiz` | `Robotik atölyesi deneyiminiz` | Kurucu/eğitmenin deneyimini soruyorsan |
| `[Kurum] robotik atölyesi` | `Kadıköy Belediyesi robotik atölyesi` | Genel kurumsal adres / yönlendirme maili |
| `[Ad] Bey/Hanım — kısa bir soru` | `Rıdvan Bey — kısa bir soru` | Kişiye özel, sıcak, teknik/genç girişimci |

## İyi örnekler
- `Probot — İnokids için 15 dakika`  (kurum adı + net çerçeve, kısa, satışsız)
- `Esenler Bilim Merkezi için kısa soru`  (merak açısı, baskısız)
- `Robotik atölyeniz — kısa bir soru`  (alıcının dünyasına dokunuyor)

## Kötü örnekler
- `Yerli robotik kitimizle tanışın!` → satış + ünlem + BİZİM hakkımızda.
- `%40 indirimli robotik eğitim fırsatı` → yasak kelimeler, fiyat, kampanya.
- `Re: Görüşme` → ilk mailde sahte Re:.
- `ACİL: Probot teklifi` → yapay aciliyet + büyük harf.
- `Merhaba` → boş/anlamsız.
- `Türkiye'nin ilk yapay zekâ destekli modüler robotik ekosistemi` → buzzword yığını, çok uzun.

## Follow-up konu satırı
İlk takip ve son takip aynı thread'de → konu `Re: [ilk konu]` (gerçek devam, sahte değil).
Yeni konu satırı AÇMA.
