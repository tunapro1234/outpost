# ProBot Studio Mail / Outreach Tarama Raporu

**Tarama tarihi:** 16 Temmuz 2026  
**Kapsam:** `/srv/probot`, özellikle `/business` ve `/outreach`  
**Yöntem:** Salt-okur dosya adı ve içerik taraması; Markdown, CSV, JSON, HTML ve kanonik saha PDF’si incelendi. Dosyalarda değişiklik yapılmadı.

## Yönetici özeti

- 41 outreach taslak dosyası bulundu; bunların 40’ı `durum: oneri`, biri rota notu.
- `/outreach/gonderilen.md` içinde gerçek `durum: gönderildi` kaydı yok. Yalnızca şema amaçlı bir örnek bulunuyor.
- `/outreach/cevaplar.md` içinde gerçek alıcı cevabı yok; yalnızca yorum içine alınmış örnek kayıt var.
- Bu nedenle depodan gerçek ProBot gönderim performansı, cevap oranı veya çalışan cevap metni çıkarılamıyor.
- Güncel otorite `/outreach/mail-kurallari/kurallar.md` dosyasıdır. Eski playbook ve taslaklarda bu kurallarla çelişen ifadeler bulunuyor.
- ProBot’un konumu: yerli, modüler robotik eğitim donanımı ile builder/blocks/docs yazılım katmanını birleştiren, erken aşamadaki bir robotik öğrenme ekosistemi.
- İlk GTM odağı doğrudan veli satışı değil; küçük bağımsız atölyeler, kurslar, bilim merkezleri, okullar ve mevcut eğitim/yarışma kanalları üzerinden B2B2C.
- Bazı eski mail iddiaları güncel kanonla doğrulanmıyor: kesin fiyat, ESP32, “30 kit teslimatı”, “48 saatte yedek”, resmi impact kiti gibi ifadeler gönderimden önce teyit edilmeli.

# A) Bulunan asset envanteri

## 1. Kanonik mail kuralları ve araştırma

| Yol | İçerik |
|---|---|
| `/srv/probot/outreach/mail-kurallari/kurallar.md` | 12 Temmuz revizyonlu kanonik dil, uzunluk, CTA, kişiselleştirme, gönderim ve takip kuralları. |
| `/srv/probot/outreach/mail-kurallari/arastirma-notlari.md` | YC, cold outreach, konu satırı, hitap, follow-up ve teslim edilebilirlik araştırmasının ProBot’a uyarlaması. |
| `/srv/probot/outreach/arastirma/mail-arastirma.md` | Yanıt oranı, CTA, kişiselleştirme, zamanlama, hacim ve takip kadansı üzerine ayrıntılı araştırma. |
| `/srv/probot/outreach/arastirma/mail-ornekleri.md` | Gerçek dış kaynak örnekleri, alıcı psikolojisi, reddedilen ProBot taslaklarının teşhisi ve Esenler iskeletleri. |
| `/srv/probot/outreach/arastirma/bogazici-mail-kurallari.md` | Boğaziçi bağlantısının outreach’te nasıl ve ne zaman kullanılabileceğine ilişkin notlar. |
| `/srv/probot/business/research/yc-outreach-kurallari.md` | YC tabanlı kısa mail, açık CTA ve kişiselleştirme önerileri; bazı maddeleri daha yeni kanonla çelişiyor. |
| `/srv/probot/outreach/arastirma/interview-anket-arastirma.md` | Mail sonrasında yapılacak müşteri görüşmesi ve anket tasarımı araştırması. |
| `/srv/probot/outreach/arastirma/veri-toplama-yontemleri.md` | Outreach sonrası saha verisinin nasıl toplanacağına dair yöntem notları. |
| `/srv/probot/outreach/arastirma/kartvizit-hediye-lojistik.md` | Fiziksel ziyaret, kartvizit ve hediye/numune lojistiği araştırması. |

## 2. Playbook ve şablonlar

| Yol | İçerik |
|---|---|
| `/srv/probot/business/reach-playbook.md` | Dört haftalık kampanya, kanal sırası, takip, itirazlar ve görüşmeden pilota geçiş planı. |
| `/srv/probot/business/reach-sablonlar.md` | Atölye, LEGO yenileme ve kurulumcu segmentleri için eski A/B/C mail ve WhatsApp şablonları. |
| `/srv/probot/outreach/HANDOVER.md` | Outreach ajanının rolü, onay zorunluluğu, ton, hedef veri kaynakları ve Temmuz durum özeti. |
| `/srv/probot/outreach/PIPELINE.md` | Kurum keşfi, dossier üretimi, kalite kontrolü ve panel oluşturma süreci. |
| `/srv/probot/outreach/HOOKS.md` | Gönderilen mail ve gelen cevap kayıtlarından follow-up uyarısı üretme mekanizması. |
| `/srv/probot/outreach/FRC-FTC-DURUM.md` | FRC/FTC veri havuzunun durumu; mevcut takımların ana müşteri olmadığı stratejik sınır açısından önemli. |

## 3. Yerel ProBot mail ve mesaj taslakları

| Yol | İçerik |
|---|---|
| `/srv/probot/outreach/taslaklar/oneri/` | 23 kişiye/kuruma özel ilk temas taslağı; tümü öneri durumunda. |
| `/srv/probot/outreach/taslaklar/oneri-3lu/` | Esenler için 6, İnokids için 3 alternatif olmak üzere 9 varyant. |
| `/srv/probot/outreach/taslaklar/cuma-17tem/` | Sekiz kurum için belirli bir saha gününe bağlı mail/WhatsApp taslağı ve rota dosyası. |
| `/srv/probot/outreach/taslaklar/oneri/adem-ay.md` | İz Atölye’ye dağıtıcı ve saha kullanıcısı perspektifinden dinleme talebi. |
| `/srv/probot/outreach/taslaklar/oneri/ridvan-canbaz.md` | Kendi donanım ve müfredatını geliştirmiş bir kurucuya deneyim danışma taslağı. |
| `/srv/probot/outreach/taslaklar/oneri/ertugrul-erbay.md` | Belediye atölyesine çocuk ve eğitmen deneyimini öğrenme odaklı taslak. |
| `/srv/probot/outreach/taslaklar/oneri-3lu/esenler-bilim-merkezi-B.md` | Yedek parça ve yerli muhatap acısını soru üzerinden açan güçlü varyant. |
| `/srv/probot/outreach/taslaklar/oneri-3lu/esenler-bilim-merkezi-F.md` | Tasarımın saha deneyimine göre şekillenmesi temasını kullanan kısa varyant. |
| `/srv/probot/outreach/taslaklar/cuma-17tem/hypatia-robotic.md` | Mail adresi bulunmayan hedef için WhatsApp açılışı. |
| `/srv/probot/outreach/taslaklar/cuma-17tem/00-ROTA.md` | Anadolu yakasındaki sekiz hedefin coğrafi saha rotası ve iletişim güveni özeti. |

## 4. Gönderim ve cevap kayıtları

| Yol | İçerik |
|---|---|
| `/srv/probot/outreach/gonderilen.md` | Gerçek gönderimler için kayıt şeması; mevcut tek kayıt `durum: örnek`, dolayısıyla gerçek gönderim yok. |
| `/srv/probot/outreach/cevaplar.md` | Gelen cevap kayıt şeması; gerçek cevap bulunmuyor. |
| `/srv/probot/outreach/hooks/state/incoming.json` | Gelen kutusu tarayıcısının işlediği teknik mesaj kimlikleri; outreach cevabı içeriği değil. |

## 5. Hedef, kişi ve kanal verileri

| Yol | İçerik |
|---|---|
| `/srv/probot/business/reach-targets.md` | Dört segmentte 40 hedef kurum; 31 doğrulanmış mail ve kanal notları. |
| `/srv/probot/business/reach-mail-listesi.csv` | Yaklaşık 87 mailli kurumdan oluşan outreach listesi. |
| `/srv/probot/business/research/master-liste.csv` | 203 tekil kurumun ham iletişim havuzu. |
| `/srv/probot/business/research/kurum-skorlari.csv` | 217 kurumun alım, erişim, kanca, çarpan ve lojistik skorları. |
| `/srv/probot/business/research/kisiler/` | Kurucu, müdür ve eğitmen keşfi için kişi araştırma dosyaları. |
| `/srv/probot/business/research/kurumlar/` | Mail yazılmadan önce okunması beklenen ayrıntılı kurum profilleri. |
| `/srv/probot/outreach/mail-pipeline/dossier/` | 66 kurum için mail kanalı, kişi, kanca ve risk özetleri. |
| `/srv/probot/outreach/vault/` | 1.867 kurum, kişi ve kanal notundan oluşan geniş ilişki kasası. |
| `/srv/probot/outreach/mail-kesif/README.md` | Açık kaynak mail keşfi ve güven sınıflandırmasının işleyişi. |
| `/srv/probot/outreach/mail-kesif/patterns.csv` | Kurum alan adları için olası mail kalıpları; tahmini adreslerin gönderim riski var. |

## 6. ProBot ürünü, pazar ve konumlandırma

| Yol | İçerik |
|---|---|
| `/srv/probot/KIT.md` | En güncel ürün ve ekip kanonu; kesin olmayan özellik ve fiyatların dışarıya taşınmasını yasaklıyor. |
| `/srv/probot/business/idea.md` | Ürünün kökeni, pilotlar, yazılım-mekanik birleşimi, impact ve gelir modeli fikirleri. |
| `/srv/probot/business/customer.md` | Veli, okul/atölye ve yarışma segmentlerini; B2B2C önceliğini tanımlayan taslak. |
| `/srv/probot/business/constraint.md` | Ana darboğazın müşteri bulmak olduğunu ve seçilen talep kanallarını açıklıyor. |
| `/srv/probot/business/piyasa-raporu.md` | 217 kurumluk pazar sentezi, hedef segmentler, rekabet boşlukları ve saha gereksinimi. |
| `/srv/probot/business/harita-vault/Probot.md` | ProBot’un ilişki haritasındaki merkez konumu, kökeni, pilotları ve aday ortaklıkları. |
| `/srv/probot/business/channels.md` | Warm outreach, B2B, distribütör, içerik ve yarışma kanallarının karşılaştırması. |
| `/srv/probot/business/design-review/KIT-POSITIONING-A.md` | Eski “Mucit” konumlandırması; paket adı daha sonra bırakıldığı için güncel copy kaynağı değil. |

## 7. Görüşme ve öğrenme malzemeleri

| Yol | İçerik |
|---|---|
| `/srv/probot/business/saha-ogrenme-plani.md` | Mailden sonra yapılacak 15 dakikalık görüşmenin akışı ve öğrenme hedefleri. |
| `/srv/probot/business/saha-gorusme-kagidi-v13.pdf` | Güncel saha formu: işletme derdi, kullanılan set, alım geçmişi, çocuk/veli, müfredat, yarışma ve tedarikçi deneyimi. |
| `/srv/probot/business/anket-degerlendirme.md` | Mom Test yaklaşımıyla soru kalitesini ve sinyal puanlamasını değerlendiriyor. |
| `/srv/probot/business/anket-telefon-varyanti.md` | Telefon görüşmesini ziyarete dönüştüren 15 dakikalık varyant. |
| `/srv/probot/business/anket-ege-varyanti.md` | Belediye, halk eğitim ve kurumsal karar süreçlerine uyarlanmış Ege varyantı. |

# B) Mail stili gözlemleri

## 1. Güncel ton

Kanonik tarif:

> “profesyonel olmaya çalışan öğrenci.”

Bu, şu dengeyi kuruyor:

- Doğal ve insani, fakat laubali değil.
- Saygılı “siz” dili, fakat “değerli kurumunuz” gibi kurumsal klişeler yok.
- Satışçı özgüveni yerine üretici merakı ve açık dinleme niyeti.
- Cümle başları büyük, standart Türkçe yazım ve düzgün noktalama.

Doğru kimlik cümlesi kanonda şöyle sadeleştiriliyor:

> “Probot adında yerli bir robotik eğitim kiti geliştiriyoruz.”

“Arkadaşımla birlikte”, “Boğaziçi’nde okuyorum” ve uzun kurucu hikâyesi güncel kanonda gövdeden çıkarılmış.

## 2. Mailin amacı satış değil, görüşme kapısı açmak

Taslaklarda en tutarlı ifade:

> “Bir şey satmaya çalışmıyoruz.”

Başarılı kabul edilen yapı, ürünü uzun uzun anlatmak yerine tek bir saha sorusuna geçiyor:

> “Kullandığınız setlerde nelerden memnunsunuz, neler sizi uğraştırıyor?”

İlk mailin başarı ölçütü satış değil:

- Doğru kişiden yanıt almak.
- 15 dakikalık dinleme görüşmesi açmak.
- Gerekirse doğru kişiye yönlendirilmek.
- Gerçek sorun ve geçmiş davranış öğrenmek.

## 3. Alıcı merkezli olma

`mail-ornekleri.md`, reddedilen ilk taslakları şu nedenle eleştiriyor:

> “Üçü de BİZİM hakkımızda.”

Önerilen dönüşüm:

- “Biz ürünü doğrulamak istiyoruz” yerine “Sizin işinizi ne zorlaştırıyor?”
- “Atölyeniz bizim için iyi bir sınav” yerine “Sizin girdiniz üründe söz hakkı yaratabilir.”
- “Kitimizi göstermek istiyoruz” yerine “Yedek, tedarik veya sınıf kullanımında ne yaşıyorsunuz?”

Güçlü yerel örnek:

> “Yurtdışı setlerde parça kırıldığında ya da destek gerektiğinde işi nasıl çeviriyorsunuz?”

Bu, çözümü dayatmadan önce alıcının mevcut davranışını soruyor.

## 4. Kişiselleştirme sınırı

Güncel kural, araştırmayı hedef seçmek için kullanıyor; mailde sergilemiyor.

Kullanılabilir:

- Kurumun kendi sitesindeki güncel program.
- Kendi vitrini veya duyurusunda öne çıkardığı yaklaşım.
- Kurucunun açıkça anlattığı ürün veya eğitim hikâyesi.

Kullanılmaması gerekenler:

- İhale ve satın alma kayıtları.
- Eski tedarik dökümleri.
- Kişinin geçmişine dair derin araştırma.
- Uydurulmuş mahalle, okul veya ortak tanıdık yakınlığı.

Eski HANDOVER’daki “araştırma yaptığımız belli olacak” talimatı, 12 Temmuz kanonunda daraltılmıştır. Güncel kanon önceliklidir.

## 5. Yapı ve uzunluk

Kanonik hedef 80 kelime, mutlak tavan 120 kelime:

1. Kısa kimlik.
2. Kurumun işine dair tek yüzeysel ve gerçek bağ.
3. Tek somut merak sorusu.
4. Gün ve saat dayatmayan 15 dakika ricası.
5. Kolay hayır kapısı.
6. Sabit iki satırlık imza.

Doğal kapanış örneği:

> “Denk gelmezse sorun değil.”

Alternatif:

> “Uygun değilse tek satır yeter.”

## 6. CTA biçimi

Kanonik CTA süreyi söyler, günü dayatmaz:

> “Önümüzdeki günlerde size uygun bir vakitte 15 dakika uğrayabilir miyim?”

Bunun hemen öncesinde tek bir merak sorusu bulunması bekleniyor.

`cuma-17tem` taslakları belirli tarih ve saat aralığı verdiği için güncel genel kuralla çelişiyor. Bunlar saha rotası için hazırlanmış özel/eski taslaklardır; kanonik şablon olarak yeniden kullanılmamalı.

## 7. Konu satırı

Güncel kural:

- 3–5 kelime.
- Kurum veya kişi adına referans.
- Satış, kampanya, fırsat, ücretsiz gibi kelimeler yok.
- Ünlem, emoji, büyük harf bloğu yok.
- İlk mailde sahte `Re:` yok.

Kanonik kalıp:

> “Probot — [Kurum] için 15 dakika”

Eski `reach-sablonlar.md` içindeki uzun, ürün iddialı konu satırları güncel standarda göre fazla satış odaklı.

## 8. Görsel ve biçim

İlk mail:

- Düz metin.
- Madde listesi yok.
- Emoji yok.
- Görsel ve ek yok.
- En fazla bir link.
- Takip pikseli önerilmiyor.
- İmza sabit:

```text
Tuna
probotstudio.com · 0538 040 81 48
```

## 9. Follow-up stili

Kanonik kadans:

- Gün 0: ilk mail.
- Gün 4–5: aynı thread’de 2–4 cümlelik ilk takip; yeni bir somut soru veya değer ekler.
- Gün 10–12: ikinci ve son takip; eşiği düşürür veya doğru kişiyi sorar.
- Yanıt, ret veya “yazmayın” gelirse sekans hemen durur.
- Toplam en fazla üç mail.

Yasak ton:

> “Dönüş alamadım.”

Tercih edilen yaklaşım suçlamadan bağlam eklemek ve kolay çıkış sunmaktır.

## 10. Bilinçli yazım hatası

Kanon, doğal görünüyorsa mail başına en fazla bir komşu tuş veya çift harf hatasına izin veriyor. Taslaklarda “etmeeyiz”, “istuyoruz”, “merakk” gibi örnekler var.

Bu uygulama zorunlu değil ve marka güvenini azaltabilir. Yeniden kullanılabilir kalıplara taşınmaması, yalnızca Tuna’nın tekil onayıyla uygulanması daha güvenli.

## 11. Gerçek gönderim ve cevap dersi

Depodan çıkarılabilecek performans dersi yok:

- Gerçek gönderilmiş ProBot maili: bulunamadı.
- Gerçek cevap: bulunamadı.
- Gerçek ret: bulunamadı.
- Açılma, cevap veya görüşme dönüşümü: kayıt yok.

Dolayısıyla taslakların “çalıştığı” söylenemez; yalnızca kurala uygunluğu ve yazı kalitesi değerlendirilebilir.

# C) ProBot Studio bağlam özeti

## Ne satıyor?

ProBot Studio, robotik eğitim için birbirine bağlı bir ekosistem geliştiriyor:

- Modüler fiziksel robotik kit ve yapı parçaları.
- Küçük robottan daha büyük şasiye uzanan yeniden kurulabilir mekanik sistem.
- Görsel tasarım/builder yüzeyi.
- Blocks ve `probot-core` yazılımı.
- Türkçe dokümantasyon, örnek kod ve self-service proje rehberleri.
- İleride sınıf paneli, öğrenci lisansı, sezon paketi, yedek parça ve kiralama gibi tekrarlı gelir katmanları.

Güncel paket adları:

- Başlangıç
- Gelişim
- Şampiyon

Eski “Mucit” adı bırakılmıştır.

## Ürün durumu

- Aktif geliştirme ve yarışma sonrası teknik güncelleme aşamasında.
- Elektronik mimari kesinleşmemiş; ESP32 veya başka kart iddiası güncel teyit gerektiriyor.
- Mekanik yapı ve BOM hâlâ değişebilir.
- Sitedeki 14.900/22.900 TL gibi fiyatlar `KIT.md` tarafından placeholder olarak işaretlenmiş.
- ProBot markası altında tamamlanmış satış kaydı bulunmuyor.
- Site canlı; eski notlarda ödeme kapalı, sipariş/ilgi akışının WhatsApp ve bekleme listesi üzerinden yürüdüğü belirtiliyor.

## Kime satmayı planlıyor?

Birincil kısa vadeli hedefler:

- Küçük, bağımsız robotik/kodlama atölyeleri.
- Kurs merkezleri ve bilim merkezleri.
- Özel okullar, BİLSEM’ler ve okul kulüpleri.
- Belediye teknoloji atölyeleri.
- Mevcut eğitim ve yarışma programları üzerinden kite dokunan 10–16 yaş grubu.
- Satın alamayan takım veya kurumlar için kiralama müşterileri.

İkinci dalga:

- Büyük okul zincirleri.
- Kurulumcular ve distribütörler.
- Robotistan gibi perakende/vitrin kanalları.
- Eğitim programından veya yarışmadan sonra evde devam etmek isteyen veliler.

Hedef dışı veya düşük öncelikli:

- Mevcut FRC/FTC takımlarına klasik parça satışı.
- Soğuk, eğitimsiz doğrudan veli satışı.
- Kanıt oluşmadan geniş distribütör açılımı.

## Değer önerisi

En savunulabilir değer önerileri:

- Yerli üretici ve ulaşılabilir muhatap.
- İthal setlere göre tedarik ve yedek parça sürtünmesini azaltma potansiyeli.
- Oyuncak ölçeğinden daha gerçek mekanik ve robot yapım deneyimi.
- Aynı parçalarla farklı robotların kurulabildiği modülerlik.
- Türkçe dokümantasyon ve örnek kodla self-service kullanım.
- Atölyenin eğitim işletmesini ProBot’un üstlenmesini gerektirmeyen donanım + docs modeli.
- Yarışma, proje ve portfolyo üretimiyle kitin “raf ürünü” olmaktan çıkması.

Mailde doğrulanmadan kullanılmaması gereken vaatler:

- Kesin fiyat.
- Kesin elektronik kart.
- “48 saatte yedek”.
- “30 kit teslim ettik.”
- “Impact’in resmi kiti.”
- Kesin metal gövde veya her pakette aynı malzeme.
- Garanti veya kesin stok sözü.

## Referanslar ve güven unsurları

İç dosyalarda görülen referanslar:

- Tuna’nın MEB İstanbul Tasarla Geliştir / İMFEST altyapı yazılımını geliştirmiş olması.
- `probot-core` yazılım kökeni.
- Seadragons takımına eğitim verilmesi.
- Altı çocuğa eğitim ve kit pilotu.
- Bir yarışmanın gerçekleştirilmiş olması.
- Tuna’nın NFR Products kurucularından biri olarak yarışma-parça pazarını içeriden tanıması.
- Hüseyin’in mekanik, Tuna’nın yazılım tarafını üstlendiği iki kişilik teknik ekip.
- `impact.tr` yarışma organizasyonu ile mevcut ilişki.

Statü uyarıları:

- Impact’in “resmi kit” ilişkisi hedef/plan olarak geçiyor; yazılı mutabakatın açık iş olduğu belirtilmiş.
- “30 kitlik eğitim programı” eski şablonlarda sosyal kanıt olarak kullanılıyor, fakat taranan gönderim veya teslimat kayıtları bunu doğrulamıyor.
- “Ertuğ ilk B2B müşteri” ifadesi ilişki kasasında bulunuyor; teslimat durumu ayrıca teyit edilmeli.

## En güçlü kısa konumlandırma

Dış iletişim için güvenli çekirdek:

> ProBot, çocukların kendi robotlarını kurup kodlayabildiği, yerli geliştirilen modüler bir robotik eğitim sistemi. Donanımı Türkçe dokümantasyon, örnek kod ve tasarım araçlarıyla birlikte sunmayı hedefliyor.

# D) Yeniden kullanılabilir kalıplar

Aşağıdaki kalıplar güncel kanona göre sadeleştirilmiştir. Köşeli alanlar doğrulanmış bilgiyle doldurulmalıdır.

## 1. Genel keşif maili

**Konu:** `Probot — [Kurum] için 15 dakika`

```text
Merhaba [Ad] Bey/Hanım,

Probot adında yerli bir robotik eğitim kiti geliştiriyoruz. [Kurumun kendi sitesinde öne çıkardığı tek, yüzeysel ayrıntı] nedeniyle özellikle size yazmak istedim.

Derslerde kullandığınız setlerde sizi en çok neyin uğraştırdığını merak ediyorum. Önümüzdeki günlerde size uygun bir vakitte 15 dakika uğrayıp sizi dinleyebilir miyim?

Uygun değilse sorun değil.

Tuna
probotstudio.com · 0538 040 81 48
```

## 2. Yedek parça / tedarik acısı kalıbı

**Konu:** `[Kurum] için kısa soru`

```text
Merhaba [Ad] Bey/Hanım,

Probot adında yerli bir robotik eğitim kiti geliştiriyoruz. İthal setlerde bir parça kırıldığında veya destek gerektiğinde süreci nasıl çözdüğünüzü merak ediyorum.

Yerel bir üreticinin bu tarafta gerçekten fayda sağlayıp sağlamayacağını sizden dinlemek isterim. Size uygun bir vakitte 15 dakika uğramam mümkün olur mu?

Tuna
probotstudio.com · 0538 040 81 48
```

## 3. Kendi kitini veya müfredatını geliştirmiş kurucu

**Konu:** `[Kurum] deneyiminiz`

```text
Merhaba [Ad] Bey/Hanım,

Probot adında yerli bir robotik eğitim kiti geliştiriyoruz. [Kurumun kendi yayımladığı ürün/müfredat] yaklaşımınızı görünce, bir sistemi sahada kurmuş birinin deneyimini dinlemek istedim.

Geliştirirken sizi en çok zorlayan karar neydi? Önümüzdeki günlerde size uygun bir vakitte 15 dakika uğrayabilir miyim?

Tuna
probotstudio.com · 0538 040 81 48
```

## 4. Genel kurumsal adrese yönlendirme maili

**Konu:** `[Kurum] robotik atölyesi`

```text
Merhaba,

Probot adında yerli bir robotik eğitim kiti geliştiriyoruz. [Kurumun yayımladığı program] kapsamında kullanılan setleri ve eğitmenlerin yaşadığı zorlukları öğrenmek istiyoruz.

Robotik atölyesini yürüten kişiyle 15 dakikalık kısa bir görüşme yapmamız mümkün olur mu? Bu mesajı doğru kişiye iletebilirseniz sevinirim.

Tuna
probotstudio.com · 0538 040 81 48
```

## 5. WhatsApp ilk temas

```text
Merhaba [Ad] Bey/Hanım, ben Tuna. Probot adında yerli bir robotik eğitim kiti geliştiriyoruz. [Tek yüzeysel kurum bağı] nedeniyle size ulaşmak istedim. Derslerde kullandığınız setlerde en çok nerede zorlandığınızı 15 dakika dinleyebilir miyim? Uygun değilse sorun değil.
```

Tek mesaj gönderilir; cevap yoksa WhatsApp üzerinden seri mesaj atılmaz.

## 6. İlk follow-up

Aynı mail zincirinde:

```text
Merhaba [Ad] Bey/Hanım,

Önceki mailime kısa bir şey eklemek istedim. Görüşmede özellikle [tek somut konu: yedek süresi / çocukların takıldığı nokta / dokümantasyon ihtiyacı] tarafını anlamaya çalışıyoruz.

Size uygun bir vakitte 15 dakika konuşmamız mümkün olur mu?
```

## 7. İkinci ve son follow-up

```text
Merhaba [Ad] Bey/Hanım,

Sanırım zamanı denk gelmedi, sorun değil. Ziyaret yerine önce iki kısa görsel ve ürünün ne aşamada olduğunu iletmem daha kolaysa öyle ilerleyebilirim.

Bu şekilde devam edelim mi, yoksa şimdilik kapatayım mı?
```

Alternatif yönlendirme sorusu:

```text
Bu konuyu kurumunuzda konuşmam gereken daha doğru biri varsa adını paylaşabilir misiniz?
```

## 8. Olumlu cevaba yanıt

Depoda gerçek örnek bulunmadığı için türetilmiş kalıp:

```text
Merhaba [Ad] Bey/Hanım,

Çok teşekkür ederim. Görüşmede ağırlıklı olarak kullandığınız setleri, sınıfta yaşadığınız sorunları ve önümüzdeki dönem planınızı dinlemek istiyorum. 15 dakikayı geçmemeye dikkat edeceğim.

Size uygun gün ve saatleri paylaşırsanız ona göre gelebilirim.

İyi çalışmalar,
Tuna
```

## 9. “Şu an uygun değil” cevabı

```text
Anladım, haber verdiğiniz için teşekkür ederim. Şimdilik konuyu kapatıyorum; tekrar yazmamı istediğiniz bir dönem olursa memnuniyetle dönerim.

İyi çalışmalar,
Tuna
```

## 10. Açık ret veya “yazmayın” cevabı

```text
Elbette, not aldım. Tekrar iletişime geçmeyeceğim.

İyi çalışmalar,
Tuna
```

Ardından kişi/kurum ret listesine işlenmeli ve tüm follow-up’lar durdurulmalı.

## 11. Gönderim öncesi kısa kontrol listesi

- Alıcının adı ve rolü doğrulandı mı?
- Mail adresi yayımlanmış veya güvenilir mi?
- Kişiselleştirme kurumun kendi vitrininden mi?
- Metin 120 kelimenin altında mı?
- Tek merak sorusu var mı?
- Tek CTA ve 15 dakika sınırı var mı?
- Gün/saat dayatması kaldırıldı mı?
- Kesin olmayan fiyat, kart, stok, teslimat veya referans iddiası var mı?
- En fazla bir link ve hiç ek/görsel olmaması sağlandı mı?
- Alıcı daha önce ret verdi mi?
- Tuna’nın tekil gönderim onayı alındı mı?
- Gönderim Salı–Perşembe, 08.00–11.00 aralığında mı?
- Gönderim gerçekse `gonderilen.md` kaydı ve Message-ID hazırlanmış mı?

## Sonuç

Depoda güçlü bir araştırma, hedefleme ve taslak altyapısı var; eksik olan katman gerçek gönderim ve cevap verisi. En güvenli çalışma sırası, 12 Temmuz tarihli kanonik kuralları esas almak, eski şablonlardaki doğrulanmamış ürün iddialarını temizlemek, küçük bir onaylı dalga göndermek ve her gönderim/cevabı kayıt altına almaktır.
tokens used
106,193
# ProBot Studio Mail / Outreach Tarama Raporu

**Tarama tarihi:** 16 Temmuz 2026  
**Kapsam:** `/srv/probot`, özellikle `/business` ve `/outreach`  
**Yöntem:** Salt-okur dosya adı ve içerik taraması; Markdown, CSV, JSON, HTML ve kanonik saha PDF’si incelendi. Dosyalarda değişiklik yapılmadı.

## Yönetici özeti

- 41 outreach taslak dosyası bulundu; bunların 40’ı `durum: oneri`, biri rota notu.
- `/outreach/gonderilen.md` içinde gerçek `durum: gönderildi` kaydı yok. Yalnızca şema amaçlı bir örnek bulunuyor.
- `/outreach/cevaplar.md` içinde gerçek alıcı cevabı yok; yalnızca yorum içine alınmış örnek kayıt var.
- Bu nedenle depodan gerçek ProBot gönderim performansı, cevap oranı veya çalışan cevap metni çıkarılamıyor.
- Güncel otorite `/outreach/mail-kurallari/kurallar.md` dosyasıdır. Eski playbook ve taslaklarda bu kurallarla çelişen ifadeler bulunuyor.
- ProBot’un konumu: yerli, modüler robotik eğitim donanımı ile builder/blocks/docs yazılım katmanını birleştiren, erken aşamadaki bir robotik öğrenme ekosistemi.
- İlk GTM odağı doğrudan veli satışı değil; küçük bağımsız atölyeler, kurslar, bilim merkezleri, okullar ve mevcut eğitim/yarışma kanalları üzerinden B2B2C.
- Bazı eski mail iddiaları güncel kanonla doğrulanmıyor: kesin fiyat, ESP32, “30 kit teslimatı”, “48 saatte yedek”, resmi impact kiti gibi ifadeler gönderimden önce teyit edilmeli.

# A) Bulunan asset envanteri

## 1. Kanonik mail kuralları ve araştırma

| Yol | İçerik |
|---|---|
| `/srv/probot/outreach/mail-kurallari/kurallar.md` | 12 Temmuz revizyonlu kanonik dil, uzunluk, CTA, kişiselleştirme, gönderim ve takip kuralları. |
| `/srv/probot/outreach/mail-kurallari/arastirma-notlari.md` | YC, cold outreach, konu satırı, hitap, follow-up ve teslim edilebilirlik araştırmasının ProBot’a uyarlaması. |
| `/srv/probot/outreach/arastirma/mail-arastirma.md` | Yanıt oranı, CTA, kişiselleştirme, zamanlama, hacim ve takip kadansı üzerine ayrıntılı araştırma. |
| `/srv/probot/outreach/arastirma/mail-ornekleri.md` | Gerçek dış kaynak örnekleri, alıcı psikolojisi, reddedilen ProBot taslaklarının teşhisi ve Esenler iskeletleri. |
| `/srv/probot/outreach/arastirma/bogazici-mail-kurallari.md` | Boğaziçi bağlantısının outreach’te nasıl ve ne zaman kullanılabileceğine ilişkin notlar. |
| `/srv/probot/business/research/yc-outreach-kurallari.md` | YC tabanlı kısa mail, açık CTA ve kişiselleştirme önerileri; bazı maddeleri daha yeni kanonla çelişiyor. |
| `/srv/probot/outreach/arastirma/interview-anket-arastirma.md` | Mail sonrasında yapılacak müşteri görüşmesi ve anket tasarımı araştırması. |
| `/srv/probot/outreach/arastirma/veri-toplama-yontemleri.md` | Outreach sonrası saha verisinin nasıl toplanacağına dair yöntem notları. |
| `/srv/probot/outreach/arastirma/kartvizit-hediye-lojistik.md` | Fiziksel ziyaret, kartvizit ve hediye/numune lojistiği araştırması. |

## 2. Playbook ve şablonlar

| Yol | İçerik |
|---|---|
| `/srv/probot/business/reach-playbook.md` | Dört haftalık kampanya, kanal sırası, takip, itirazlar ve görüşmeden pilota geçiş planı. |
| `/srv/probot/business/reach-sablonlar.md` | Atölye, LEGO yenileme ve kurulumcu segmentleri için eski A/B/C mail ve WhatsApp şablonları. |
| `/srv/probot/outreach/HANDOVER.md` | Outreach ajanının rolü, onay zorunluluğu, ton, hedef veri kaynakları ve Temmuz durum özeti. |
| `/srv/probot/outreach/PIPELINE.md` | Kurum keşfi, dossier üretimi, kalite kontrolü ve panel oluşturma süreci. |
| `/srv/probot/outreach/HOOKS.md` | Gönderilen mail ve gelen cevap kayıtlarından follow-up uyarısı üretme mekanizması. |
| `/srv/probot/outreach/FRC-FTC-DURUM.md` | FRC/FTC veri havuzunun durumu; mevcut takımların ana müşteri olmadığı stratejik sınır açısından önemli. |

## 3. Yerel ProBot mail ve mesaj taslakları

| Yol | İçerik |
|---|---|
| `/srv/probot/outreach/taslaklar/oneri/` | 23 kişiye/kuruma özel ilk temas taslağı; tümü öneri durumunda. |
| `/srv/probot/outreach/taslaklar/oneri-3lu/` | Esenler için 6, İnokids için 3 alternatif olmak üzere 9 varyant. |
| `/srv/probot/outreach/taslaklar/cuma-17tem/` | Sekiz kurum için belirli bir saha gününe bağlı mail/WhatsApp taslağı ve rota dosyası. |
| `/srv/probot/outreach/taslaklar/oneri/adem-ay.md` | İz Atölye’ye dağıtıcı ve saha kullanıcısı perspektifinden dinleme talebi. |
| `/srv/probot/outreach/taslaklar/oneri/ridvan-canbaz.md` | Kendi donanım ve müfredatını geliştirmiş bir kurucuya deneyim danışma taslağı. |
| `/srv/probot/outreach/taslaklar/oneri/ertugrul-erbay.md` | Belediye atölyesine çocuk ve eğitmen deneyimini öğrenme odaklı taslak. |
| `/srv/probot/outreach/taslaklar/oneri-3lu/esenler-bilim-merkezi-B.md` | Yedek parça ve yerli muhatap acısını soru üzerinden açan güçlü varyant. |
| `/srv/probot/outreach/taslaklar/oneri-3lu/esenler-bilim-merkezi-F.md` | Tasarımın saha deneyimine göre şekillenmesi temasını kullanan kısa varyant. |
| `/srv/probot/outreach/taslaklar/cuma-17tem/hypatia-robotic.md` | Mail adresi bulunmayan hedef için WhatsApp açılışı. |
| `/srv/probot/outreach/taslaklar/cuma-17tem/00-ROTA.md` | Anadolu yakasındaki sekiz hedefin coğrafi saha rotası ve iletişim güveni özeti. |

## 4. Gönderim ve cevap kayıtları

| Yol | İçerik |
|---|---|
| `/srv/probot/outreach/gonderilen.md` | Gerçek gönderimler için kayıt şeması; mevcut tek kayıt `durum: örnek`, dolayısıyla gerçek gönderim yok. |
| `/srv/probot/outreach/cevaplar.md` | Gelen cevap kayıt şeması; gerçek cevap bulunmuyor. |
| `/srv/probot/outreach/hooks/state/incoming.json` | Gelen kutusu tarayıcısının işlediği teknik mesaj kimlikleri; outreach cevabı içeriği değil. |

## 5. Hedef, kişi ve kanal verileri

| Yol | İçerik |
|---|---|
| `/srv/probot/business/reach-targets.md` | Dört segmentte 40 hedef kurum; 31 doğrulanmış mail ve kanal notları. |
| `/srv/probot/business/reach-mail-listesi.csv` | Yaklaşık 87 mailli kurumdan oluşan outreach listesi. |
| `/srv/probot/business/research/master-liste.csv` | 203 tekil kurumun ham iletişim havuzu. |
| `/srv/probot/business/research/kurum-skorlari.csv` | 217 kurumun alım, erişim, kanca, çarpan ve lojistik skorları. |
| `/srv/probot/business/research/kisiler/` | Kurucu, müdür ve eğitmen keşfi için kişi araştırma dosyaları. |
| `/srv/probot/business/research/kurumlar/` | Mail yazılmadan önce okunması beklenen ayrıntılı kurum profilleri. |
| `/srv/probot/outreach/mail-pipeline/dossier/` | 66 kurum için mail kanalı, kişi, kanca ve risk özetleri. |
| `/srv/probot/outreach/vault/` | 1.867 kurum, kişi ve kanal notundan oluşan geniş ilişki kasası. |
| `/srv/probot/outreach/mail-kesif/README.md` | Açık kaynak mail keşfi ve güven sınıflandırmasının işleyişi. |
| `/srv/probot/outreach/mail-kesif/patterns.csv` | Kurum alan adları için olası mail kalıpları; tahmini adreslerin gönderim riski var. |

## 6. ProBot ürünü, pazar ve konumlandırma

| Yol | İçerik |
|---|---|
| `/srv/probot/KIT.md` | En güncel ürün ve ekip kanonu; kesin olmayan özellik ve fiyatların dışarıya taşınmasını yasaklıyor. |
| `/srv/probot/business/idea.md` | Ürünün kökeni, pilotlar, yazılım-mekanik birleşimi, impact ve gelir modeli fikirleri. |
| `/srv/probot/business/customer.md` | Veli, okul/atölye ve yarışma segmentlerini; B2B2C önceliğini tanımlayan taslak. |
| `/srv/probot/business/constraint.md` | Ana darboğazın müşteri bulmak olduğunu ve seçilen talep kanallarını açıklıyor. |
| `/srv/probot/business/piyasa-raporu.md` | 217 kurumluk pazar sentezi, hedef segmentler, rekabet boşlukları ve saha gereksinimi. |
| `/srv/probot/business/harita-vault/Probot.md` | ProBot’un ilişki haritasındaki merkez konumu, kökeni, pilotları ve aday ortaklıkları. |
| `/srv/probot/business/channels.md` | Warm outreach, B2B, distribütör, içerik ve yarışma kanallarının karşılaştırması. |
| `/srv/probot/business/design-review/KIT-POSITIONING-A.md` | Eski “Mucit” konumlandırması; paket adı daha sonra bırakıldığı için güncel copy kaynağı değil. |

## 7. Görüşme ve öğrenme malzemeleri

| Yol | İçerik |
|---|---|
| `/srv/probot/business/saha-ogrenme-plani.md` | Mailden sonra yapılacak 15 dakikalık görüşmenin akışı ve öğrenme hedefleri. |
| `/srv/probot/business/saha-gorusme-kagidi-v13.pdf` | Güncel saha formu: işletme derdi, kullanılan set, alım geçmişi, çocuk/veli, müfredat, yarışma ve tedarikçi deneyimi. |
| `/srv/probot/business/anket-degerlendirme.md` | Mom Test yaklaşımıyla soru kalitesini ve sinyal puanlamasını değerlendiriyor. |
| `/srv/probot/business/anket-telefon-varyanti.md` | Telefon görüşmesini ziyarete dönüştüren 15 dakikalık varyant. |
| `/srv/probot/business/anket-ege-varyanti.md` | Belediye, halk eğitim ve kurumsal karar süreçlerine uyarlanmış Ege varyantı. |

# B) Mail stili gözlemleri

## 1. Güncel ton

Kanonik tarif:

> “profesyonel olmaya çalışan öğrenci.”

Bu, şu dengeyi kuruyor:

- Doğal ve insani, fakat laubali değil.
- Saygılı “siz” dili, fakat “değerli kurumunuz” gibi kurumsal klişeler yok.
- Satışçı özgüveni yerine üretici merakı ve açık dinleme niyeti.
- Cümle başları büyük, standart Türkçe yazım ve düzgün noktalama.

Doğru kimlik cümlesi kanonda şöyle sadeleştiriliyor:

> “Probot adında yerli bir robotik eğitim kiti geliştiriyoruz.”

“Arkadaşımla birlikte”, “Boğaziçi’nde okuyorum” ve uzun kurucu hikâyesi güncel kanonda gövdeden çıkarılmış.

## 2. Mailin amacı satış değil, görüşme kapısı açmak

Taslaklarda en tutarlı ifade:

> “Bir şey satmaya çalışmıyoruz.”

Başarılı kabul edilen yapı, ürünü uzun uzun anlatmak yerine tek bir saha sorusuna geçiyor:

> “Kullandığınız setlerde nelerden memnunsunuz, neler sizi uğraştırıyor?”

İlk mailin başarı ölçütü satış değil:

- Doğru kişiden yanıt almak.
- 15 dakikalık dinleme görüşmesi açmak.
- Gerekirse doğru kişiye yönlendirilmek.
- Gerçek sorun ve geçmiş davranış öğrenmek.

## 3. Alıcı merkezli olma

`mail-ornekleri.md`, reddedilen ilk taslakları şu nedenle eleştiriyor:

> “Üçü de BİZİM hakkımızda.”

Önerilen dönüşüm:

- “Biz ürünü doğrulamak istiyoruz” yerine “Sizin işinizi ne zorlaştırıyor?”
- “Atölyeniz bizim için iyi bir sınav” yerine “Sizin girdiniz üründe söz hakkı yaratabilir.”
- “Kitimizi göstermek istiyoruz” yerine “Yedek, tedarik veya sınıf kullanımında ne yaşıyorsunuz?”

Güçlü yerel örnek:

> “Yurtdışı setlerde parça kırıldığında ya da destek gerektiğinde işi nasıl çeviriyorsunuz?”

Bu, çözümü dayatmadan önce alıcının mevcut davranışını soruyor.

## 4. Kişiselleştirme sınırı

Güncel kural, araştırmayı hedef seçmek için kullanıyor; mailde sergilemiyor.

Kullanılabilir:

- Kurumun kendi sitesindeki güncel program.
- Kendi vitrini veya duyurusunda öne çıkardığı yaklaşım.
- Kurucunun açıkça anlattığı ürün veya eğitim hikâyesi.

Kullanılmaması gerekenler:

- İhale ve satın alma kayıtları.
- Eski tedarik dökümleri.
- Kişinin geçmişine dair derin araştırma.
- Uydurulmuş mahalle, okul veya ortak tanıdık yakınlığı.

Eski HANDOVER’daki “araştırma yaptığımız belli olacak” talimatı, 12 Temmuz kanonunda daraltılmıştır. Güncel kanon önceliklidir.

## 5. Yapı ve uzunluk

Kanonik hedef 80 kelime, mutlak tavan 120 kelime:

1. Kısa kimlik.
2. Kurumun işine dair tek yüzeysel ve gerçek bağ.
3. Tek somut merak sorusu.
4. Gün ve saat dayatmayan 15 dakika ricası.
5. Kolay hayır kapısı.
6. Sabit iki satırlık imza.

Doğal kapanış örneği:

> “Denk gelmezse sorun değil.”

Alternatif:

> “Uygun değilse tek satır yeter.”

## 6. CTA biçimi

Kanonik CTA süreyi söyler, günü dayatmaz:

> “Önümüzdeki günlerde size uygun bir vakitte 15 dakika uğrayabilir miyim?”

Bunun hemen öncesinde tek bir merak sorusu bulunması bekleniyor.

`cuma-17tem` taslakları belirli tarih ve saat aralığı verdiği için güncel genel kuralla çelişiyor. Bunlar saha rotası için hazırlanmış özel/eski taslaklardır; kanonik şablon olarak yeniden kullanılmamalı.

## 7. Konu satırı

Güncel kural:

- 3–5 kelime.
- Kurum veya kişi adına referans.
- Satış, kampanya, fırsat, ücretsiz gibi kelimeler yok.
- Ünlem, emoji, büyük harf bloğu yok.
- İlk mailde sahte `Re:` yok.

Kanonik kalıp:

> “Probot — [Kurum] için 15 dakika”

Eski `reach-sablonlar.md` içindeki uzun, ürün iddialı konu satırları güncel standarda göre fazla satış odaklı.

## 8. Görsel ve biçim

İlk mail:

- Düz metin.
- Madde listesi yok.
- Emoji yok.
- Görsel ve ek yok.
- En fazla bir link.
- Takip pikseli önerilmiyor.
- İmza sabit:

```text
Tuna
probotstudio.com · 0538 040 81 48
```

## 9. Follow-up stili

Kanonik kadans:

- Gün 0: ilk mail.
- Gün 4–5: aynı thread’de 2–4 cümlelik ilk takip; yeni bir somut soru veya değer ekler.
- Gün 10–12: ikinci ve son takip; eşiği düşürür veya doğru kişiyi sorar.
- Yanıt, ret veya “yazmayın” gelirse sekans hemen durur.
- Toplam en fazla üç mail.

Yasak ton:

> “Dönüş alamadım.”

Tercih edilen yaklaşım suçlamadan bağlam eklemek ve kolay çıkış sunmaktır.

## 10. Bilinçli yazım hatası

Kanon, doğal görünüyorsa mail başına en fazla bir komşu tuş veya çift harf hatasına izin veriyor. Taslaklarda “etmeeyiz”, “istuyoruz”, “merakk” gibi örnekler var.

Bu uygulama zorunlu değil ve marka güvenini azaltabilir. Yeniden kullanılabilir kalıplara taşınmaması, yalnızca Tuna’nın tekil onayıyla uygulanması daha güvenli.

## 11. Gerçek gönderim ve cevap dersi

Depodan çıkarılabilecek performans dersi yok:

- Gerçek gönderilmiş ProBot maili: bulunamadı.
- Gerçek cevap: bulunamadı.
- Gerçek ret: bulunamadı.
- Açılma, cevap veya görüşme dönüşümü: kayıt yok.

Dolayısıyla taslakların “çalıştığı” söylenemez; yalnızca kurala uygunluğu ve yazı kalitesi değerlendirilebilir.

# C) ProBot Studio bağlam özeti

## Ne satıyor?

ProBot Studio, robotik eğitim için birbirine bağlı bir ekosistem geliştiriyor:

- Modüler fiziksel robotik kit ve yapı parçaları.
- Küçük robottan daha büyük şasiye uzanan yeniden kurulabilir mekanik sistem.
- Görsel tasarım/builder yüzeyi.
- Blocks ve `probot-core` yazılımı.
- Türkçe dokümantasyon, örnek kod ve self-service proje rehberleri.
- İleride sınıf paneli, öğrenci lisansı, sezon paketi, yedek parça ve kiralama gibi tekrarlı gelir katmanları.

Güncel paket adları:

- Başlangıç
- Gelişim
- Şampiyon

Eski “Mucit” adı bırakılmıştır.

## Ürün durumu

- Aktif geliştirme ve yarışma sonrası teknik güncelleme aşamasında.
- Elektronik mimari kesinleşmemiş; ESP32 veya başka kart iddiası güncel teyit gerektiriyor.
- Mekanik yapı ve BOM hâlâ değişebilir.
- Sitedeki 14.900/22.900 TL gibi fiyatlar `KIT.md` tarafından placeholder olarak işaretlenmiş.
- ProBot markası altında tamamlanmış satış kaydı bulunmuyor.
- Site canlı; eski notlarda ödeme kapalı, sipariş/ilgi akışının WhatsApp ve bekleme listesi üzerinden yürüdüğü belirtiliyor.

## Kime satmayı planlıyor?

Birincil kısa vadeli hedefler:

- Küçük, bağımsız robotik/kodlama atölyeleri.
- Kurs merkezleri ve bilim merkezleri.
- Özel okullar, BİLSEM’ler ve okul kulüpleri.
- Belediye teknoloji atölyeleri.
- Mevcut eğitim ve yarışma programları üzerinden kite dokunan 10–16 yaş grubu.
- Satın alamayan takım veya kurumlar için kiralama müşterileri.

İkinci dalga:

- Büyük okul zincirleri.
- Kurulumcular ve distribütörler.
- Robotistan gibi perakende/vitrin kanalları.
- Eğitim programından veya yarışmadan sonra evde devam etmek isteyen veliler.

Hedef dışı veya düşük öncelikli:

- Mevcut FRC/FTC takımlarına klasik parça satışı.
- Soğuk, eğitimsiz doğrudan veli satışı.
- Kanıt oluşmadan geniş distribütör açılımı.

## Değer önerisi

En savunulabilir değer önerileri:

- Yerli üretici ve ulaşılabilir muhatap.
- İthal setlere göre tedarik ve yedek parça sürtünmesini azaltma potansiyeli.
- Oyuncak ölçeğinden daha gerçek mekanik ve robot yapım deneyimi.
- Aynı parçalarla farklı robotların kurulabildiği modülerlik.
- Türkçe dokümantasyon ve örnek kodla self-service kullanım.
- Atölyenin eğitim işletmesini ProBot’un üstlenmesini gerektirmeyen donanım + docs modeli.
- Yarışma, proje ve portfolyo üretimiyle kitin “raf ürünü” olmaktan çıkması.

Mailde doğrulanmadan kullanılmaması gereken vaatler:

- Kesin fiyat.
- Kesin elektronik kart.
- “48 saatte yedek”.
- “30 kit teslim ettik.”
- “Impact’in resmi kiti.”
- Kesin metal gövde veya her pakette aynı malzeme.
- Garanti veya kesin stok sözü.

## Referanslar ve güven unsurları

İç dosyalarda görülen referanslar:

- Tuna’nın MEB İstanbul Tasarla Geliştir / İMFEST altyapı yazılımını geliştirmiş olması.
- `probot-core` yazılım kökeni.
- Seadragons takımına eğitim verilmesi.
- Altı çocuğa eğitim ve kit pilotu.
- Bir yarışmanın gerçekleştirilmiş olması.
- Tuna’nın NFR Products kurucularından biri olarak yarışma-parça pazarını içeriden tanıması.
- Hüseyin’in mekanik, Tuna’nın yazılım tarafını üstlendiği iki kişilik teknik ekip.
- `impact.tr` yarışma organizasyonu ile mevcut ilişki.

Statü uyarıları:

- Impact’in “resmi kit” ilişkisi hedef/plan olarak geçiyor; yazılı mutabakatın açık iş olduğu belirtilmiş.
- “30 kitlik eğitim programı” eski şablonlarda sosyal kanıt olarak kullanılıyor, fakat taranan gönderim veya teslimat kayıtları bunu doğrulamıyor.
- “Ertuğ ilk B2B müşteri” ifadesi ilişki kasasında bulunuyor; teslimat durumu ayrıca teyit edilmeli.

## En güçlü kısa konumlandırma

Dış iletişim için güvenli çekirdek:

> ProBot, çocukların kendi robotlarını kurup kodlayabildiği, yerli geliştirilen modüler bir robotik eğitim sistemi. Donanımı Türkçe dokümantasyon, örnek kod ve tasarım araçlarıyla birlikte sunmayı hedefliyor.

# D) Yeniden kullanılabilir kalıplar

Aşağıdaki kalıplar güncel kanona göre sadeleştirilmiştir. Köşeli alanlar doğrulanmış bilgiyle doldurulmalıdır.

## 1. Genel keşif maili

**Konu:** `Probot — [Kurum] için 15 dakika`

```text
Merhaba [Ad] Bey/Hanım,

Probot adında yerli bir robotik eğitim kiti geliştiriyoruz. [Kurumun kendi sitesinde öne çıkardığı tek, yüzeysel ayrıntı] nedeniyle özellikle size yazmak istedim.

Derslerde kullandığınız setlerde sizi en çok neyin uğraştırdığını merak ediyorum. Önümüzdeki günlerde size uygun bir vakitte 15 dakika uğrayıp sizi dinleyebilir miyim?

Uygun değilse sorun değil.

Tuna
probotstudio.com · 0538 040 81 48
```

## 2. Yedek parça / tedarik acısı kalıbı

**Konu:** `[Kurum] için kısa soru`

```text
Merhaba [Ad] Bey/Hanım,

Probot adında yerli bir robotik eğitim kiti geliştiriyoruz. İthal setlerde bir parça kırıldığında veya destek gerektiğinde süreci nasıl çözdüğünüzü merak ediyorum.

Yerel bir üreticinin bu tarafta gerçekten fayda sağlayıp sağlamayacağını sizden dinlemek isterim. Size uygun bir vakitte 15 dakika uğramam mümkün olur mu?

Tuna
probotstudio.com · 0538 040 81 48
```

## 3. Kendi kitini veya müfredatını geliştirmiş kurucu

**Konu:** `[Kurum] deneyiminiz`

```text
Merhaba [Ad] Bey/Hanım,

Probot adında yerli bir robotik eğitim kiti geliştiriyoruz. [Kurumun kendi yayımladığı ürün/müfredat] yaklaşımınızı görünce, bir sistemi sahada kurmuş birinin deneyimini dinlemek istedim.

Geliştirirken sizi en çok zorlayan karar neydi? Önümüzdeki günlerde size uygun bir vakitte 15 dakika uğrayabilir miyim?

Tuna
probotstudio.com · 0538 040 81 48
```

## 4. Genel kurumsal adrese yönlendirme maili

**Konu:** `[Kurum] robotik atölyesi`

```text
Merhaba,

Probot adında yerli bir robotik eğitim kiti geliştiriyoruz. [Kurumun yayımladığı program] kapsamında kullanılan setleri ve eğitmenlerin yaşadığı zorlukları öğrenmek istiyoruz.

Robotik atölyesini yürüten kişiyle 15 dakikalık kısa bir görüşme yapmamız mümkün olur mu? Bu mesajı doğru kişiye iletebilirseniz sevinirim.

Tuna
probotstudio.com · 0538 040 81 48
```

## 5. WhatsApp ilk temas

```text
Merhaba [Ad] Bey/Hanım, ben Tuna. Probot adında yerli bir robotik eğitim kiti geliştiriyoruz. [Tek yüzeysel kurum bağı] nedeniyle size ulaşmak istedim. Derslerde kullandığınız setlerde en çok nerede zorlandığınızı 15 dakika dinleyebilir miyim? Uygun değilse sorun değil.
```

Tek mesaj gönderilir; cevap yoksa WhatsApp üzerinden seri mesaj atılmaz.

## 6. İlk follow-up

Aynı mail zincirinde:

```text
Merhaba [Ad] Bey/Hanım,

Önceki mailime kısa bir şey eklemek istedim. Görüşmede özellikle [tek somut konu: yedek süresi / çocukların takıldığı nokta / dokümantasyon ihtiyacı] tarafını anlamaya çalışıyoruz.

Size uygun bir vakitte 15 dakika konuşmamız mümkün olur mu?
```

## 7. İkinci ve son follow-up

```text
Merhaba [Ad] Bey/Hanım,

Sanırım zamanı denk gelmedi, sorun değil. Ziyaret yerine önce iki kısa görsel ve ürünün ne aşamada olduğunu iletmem daha kolaysa öyle ilerleyebilirim.

Bu şekilde devam edelim mi, yoksa şimdilik kapatayım mı?
```

Alternatif yönlendirme sorusu:

```text
Bu konuyu kurumunuzda konuşmam gereken daha doğru biri varsa adını paylaşabilir misiniz?
```

## 8. Olumlu cevaba yanıt

Depoda gerçek örnek bulunmadığı için türetilmiş kalıp:

```text
Merhaba [Ad] Bey/Hanım,

Çok teşekkür ederim. Görüşmede ağırlıklı olarak kullandığınız setleri, sınıfta yaşadığınız sorunları ve önümüzdeki dönem planınızı dinlemek istiyorum. 15 dakikayı geçmemeye dikkat edeceğim.

Size uygun gün ve saatleri paylaşırsanız ona göre gelebilirim.

İyi çalışmalar,
Tuna
```

## 9. “Şu an uygun değil” cevabı

```text
Anladım, haber verdiğiniz için teşekkür ederim. Şimdilik konuyu kapatıyorum; tekrar yazmamı istediğiniz bir dönem olursa memnuniyetle dönerim.

İyi çalışmalar,
Tuna
```

## 10. Açık ret veya “yazmayın” cevabı

```text
Elbette, not aldım. Tekrar iletişime geçmeyeceğim.

İyi çalışmalar,
Tuna
```

Ardından kişi/kurum ret listesine işlenmeli ve tüm follow-up’lar durdurulmalı.

## 11. Gönderim öncesi kısa kontrol listesi

- Alıcının adı ve rolü doğrulandı mı?
- Mail adresi yayımlanmış veya güvenilir mi?
- Kişiselleştirme kurumun kendi vitrininden mi?
- Metin 120 kelimenin altında mı?
- Tek merak sorusu var mı?
- Tek CTA ve 15 dakika sınırı var mı?
- Gün/saat dayatması kaldırıldı mı?
- Kesin olmayan fiyat, kart, stok, teslimat veya referans iddiası var mı?
- En fazla bir link ve hiç ek/görsel olmaması sağlandı mı?
- Alıcı daha önce ret verdi mi?
- Tuna’nın tekil gönderim onayı alındı mı?
- Gönderim Salı–Perşembe, 08.00–11.00 aralığında mı?
- Gönderim gerçekse `gonderilen.md` kaydı ve Message-ID hazırlanmış mı?

## Sonuç

Depoda güçlü bir araştırma, hedefleme ve taslak altyapısı var; eksik olan katman gerçek gönderim ve cevap verisi. En güvenli çalışma sırası, 12 Temmuz tarihli kanonik kuralları esas almak, eski şablonlardaki doğrulanmamış ürün iddialarını temizlemek, küçük bir onaylı dalga göndermek ve her gönderim/cevabı kayıt altına almaktır.
