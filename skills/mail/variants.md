# variants — 3 varyant nasıl AYRIŞIR + gerekçe formatı

mail-writer her taslakta 3 varyant üretir. Kural: **3 varyant aynı mailin makyajı DEĞİLDİR.**
Kelime değiştirmek, cümle sırasını oynatmak, "merhaba"yı "selam" yapmak varyant değildir.
Her varyant FARKLI bir açı/kanca, farklı bir ton veya farklı bir CTA sürtünmesi denemelidir —
öyle ki üçü yan yana konduğunda Tuna gerçek bir SEÇİM yapıyor olsun.

## Ayrışma eksenleri (en az BİRİNDE net ayrış — tercihen ikisinde)
1. **Açı / kanca (angle):** hangi acıya veya ilgiye dokunuyor?
   - Yedek parça / tedarik sürtünmesi (ithal set kırılınca ne yapıyorsun?).
   - Çocuğun/öğrencinin sınıfta takıldığı nokta.
   - Kurucunun kendi sistem/müfredat deneyimi.
   - Modülerlik / gerçek mekanik yapım deneyimi.
   - Dokümantasyon / self-service ihtiyacı.
   - Yerli üretici + ulaşılabilir muhatap olma.
2. **Ton (tone):** `tone-map.md`'deki tipe göre resmiyet/sıcaklık ayarı. Aynı kişiye bile iki
   farklı ton denenebilir (örn. daha resmî vs. daha akran).
3. **CTA sürtünmesi:** 15 dk ziyaret ricası ↔ "kısa özet/iki görsel ileteyim mi" ↔ "doğru kişiye
   yönlendirir misiniz". Üç varyant üç farklı eşik deneyebilir.

## Kural: her varyant tek başına kanona uygun olmalı
Ayrışma, kaliteyi düşürmenin bahanesi değil. Üçü de: 120 kelime altı, tek merak sorusu, tek CTA,
kolay hayır, doğrulanmamış iddia yok, satışsız ton. `cold-intro.md` her varyant için geçerli.

## Gerekçe formatı (her varyant için — SPEC ile birebir)
Her varyant şu alanları taşır: `subject`, `body`, `tone`, `rationale`.
`rationale` şu üçlüyü açık açık söyler:
```
{ angle: "<hangi kanca/acı>", tone: "<tone-map tipi + resmiyet>", why: "<neden bu kişi/kurum için bu açı+ton mantıklı>" }
```
`why`, hedefin gerçek bağlamına (kurum tipi, doğrulanmış hook, otorite) dayanmalı; "genelde işe
yarar" gibi boş gerekçe değil.

## İyi örnek — 3 ayrışan varyant (hedef: kendi kitini geliştirmiş atölye kurucusu)
**Varyant A**
- subject: `Rıdvan Bey, kısa bir soru`
- angle: kurucunun kendi sistem/müfredat deneyimi
- tone: teknik kişi, eş düzey sıcak
- why: Rıdvan kendi donanımını + müfredatını geliştirmiş; sahayı kurmuş biri olarak en değerli
  şeyi "karar deneyimi"; akran tonu kapıyı açar.
- body: "…bir sistemi sahada kurmuş biri olarak sizi en çok zorlayan karar neydi?" + 15 dk ziyaret.

**Varyant B**
- subject: `Yedek parça sorusu`  (aynı hedef; başka kurumun adı KONMAZ)
- angle: yedek parça / tedarik sürtünmesi
- tone: teknik kişi, doğrudan
- why: aynı kişi ama farklı acı — ithal set tedariki her atölyenin ortak derdi; ProBot'un en
  savunulabilir değer önerisiyle örtüşüyor.
- body: "İthal setlerde parça kırıldığında işi nasıl çeviriyorsunuz?" + "kısa özet ileteyim mi"
  (daha düşük sürtünmeli CTA).

**Varyant C**
- subject: `Robotik atölyeniz hakkında kısa soru`
- angle: çocukların sınıfta takıldığı nokta
- tone: eğitimci, misyona dönük
- why: kurucu aynı zamanda eğitmen; çocuk deneyimi açısı ticari baskıyı en aza indirir, "öğrenmek
  istiyoruz" niyetini öne çıkarır.
- body: "Çocuklar robot kurarken en çok nerede takılıyor?" + 15 dk ziyaret.

Üçü de kanona uygun ama Tuna GERÇEK bir seçim yapıyor: farklı kanca, farklı ton, farklı CTA eşiği.

## Kötü örnek — sahte varyantlar (BÖYLE YAPMA)
- A: "Merhaba Rıdvan Bey, … 15 dakika uğrayabilir miyim?"
- B: "Selam Rıdvan Bey, … 15 dakika görüşebilir miyim?"
- C: "Merhaba Rıdvan Bey, … 15 dakikanızı ayırır mısınız?"
Neden kötü: aynı açı, aynı ton, aynı CTA — sadece selamlama ve fiil değişmiş. Bu üç varyant değil,
tek mailin üç kopyası. Tuna'ya seçim sunmuyor.

## in-flight kuralı hatırlatma
Aynı şirketten aynı anda tek kişi (in-flight draft/approved varken o şirketten yeni taslak
yazılmaz). Varyantlar tek kişi/kurum içindir; farklı kişilere dağıtılmaz.
