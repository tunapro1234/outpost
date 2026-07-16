# context-probot — ProBot Studio bağlamı (mail-writer için zemin)

Bu dosya mail yazarken uyman gereken GERÇEK bağlamdır. Buradaki "kesin" satırları
kullanabilirsin; "TODO / doğrulanmadan yazma" işaretli satırları maile ASLA koyma.
Kaynak: sweep raporu (`docs/research/probot-mail-assets.md`, salt-okur tarama). Rapor bazı
noktalarda zayıf; emin olunmayan her şey aşağıda TODO işaretli.

## Tek cümlelik konumlandırma (güvenli çekirdek — bunu kullan)
> ProBot, çocukların kendi robotlarını kurup kodlayabildiği, yerli geliştirilen modüler bir
> robotik eğitim sistemi. Donanımı Türkçe dokümantasyon, örnek kod ve tasarım araçlarıyla
> birlikte sunmayı hedefliyor.

Mailde kimlik cümlesi olarak kanonik sadeleştirme:
> "Probot adında yerli bir robotik eğitim kiti geliştiriyoruz."

Kullanma: "Arkadaşımla birlikte", "Boğaziçi'nde okuyorum", uzun kurucu hikâyesi — bunlar güncel
kanonda gövdeden çıkarılmış. (Boğaziçi bağı yalnızca hedef seçiminde işe yarar, mail gövdesinde
sergilenmez.)

## Ne satıyor (kesin)
- Modüler fiziksel robotik kit + yeniden kurulabilir mekanik yapı parçaları.
- Görsel builder yüzeyi, Blocks ve `probot-core` yazılımı.
- Türkçe dokümantasyon, örnek kod, self-service proje rehberleri.
- İleride: sınıf paneli, öğrenci lisansı, sezon paketi, yedek parça, kiralama (tekrarlı gelir —
  henüz vaat DEĞİL, gelecek katman).
- Güncel paket adları: **Başlangıç · Gelişim · Şampiyon**. (Eski "Mucit" adı BIRAKILDI — kullanma.)

## Kime satıyor (kesin — GTM önceliği)
Birincil (kısa vade, B2B2C):
- Küçük, bağımsız robotik/kodlama atölyeleri.
- Kurs merkezleri ve bilim merkezleri.
- Özel okullar, BİLSEM'ler, okul kulüpleri.
- Belediye teknoloji atölyeleri.
- Mevcut eğitim/yarışma programları üzerinden 10–16 yaş grubuna dokunan kurumlar.
- Satın alamayan kurumlar için kiralama (hedefleme/segment açısı olarak kullan; kiralama
  yukarıda belirtildiği gibi GELECEK katman — mail gövdesinde vaat ETME).

İkinci dalga: büyük okul zincirleri, kurulumcular/distribütörler, Robotistan gibi perakende,
programdan sonra evde devam etmek isteyen veliler.

Hedef DIŞI (bunlara ProBot satış maili yazma / bu açıyı kullanma):
- Mevcut FRC/FTC takımlarına klasik parça satışı.
- Soğuk, eğitimsiz doğrudan veli satışı.
- Kanıt oluşmadan geniş distribütör açılımı.

## Değer önerisi (kesin — mailde güvenle kullanılabilir)
- Yerli üretici, ulaşılabilir muhatap.
- İthal setlere göre tedarik/yedek parça sürtünmesini azaltma **potansiyeli** ("potansiyel"
  kelimesini koru; kesin süre/oran verme).
- Oyuncak ölçeğinden daha gerçek mekanik ve robot yapım deneyimi.
- Aynı parçalarla farklı robotlar — modülerlik.
- Türkçe dokümantasyon + örnek kodla self-service.
- Atölyenin eğitim işini ProBot'un üstlenmesini gerektirmeyen donanım + docs modeli.

## ⛔ Doğrulanmadan MAİLE YAZMA (TODO — her biri gönderim öncesi Tuna teyidi ister)
- Kesin fiyat (site 14.900/22.900 TL placeholder işaretli — kullanma).
- Kesin elektronik kart ("ESP32" dahil — teyit gerektiriyor).
- "48 saatte yedek".
- "30 kit teslim ettik" / "30 kitlik eğitim programı" (teslimat kaydı doğrulanmadı).
- "Impact'in resmi kiti" (yalnızca hedef/plan, yazılı mutabakat açık iş).
- "Ertuğ ilk B2B müşteri" (teslimat durumu teyit edilmedi).
- Kesin metal gövde / her pakette aynı malzeme.
- Garanti veya kesin stok sözü.
- Tamamlanmış satış kaydı yok — "müşterimiz", "sattık" deme.

## Referans / güven unsurları (dikkatli kullan — çoğu iç bilgi, mailde öne çıkarma)
İç dosyalarda geçenler: Tuna'nın MEB İstanbul Tasarla Geliştir / İMFEST altyapı yazılımı,
`probot-core` kökeni, Seadragons takımına eğitim, altı çocukluk pilot, bir yarışmanın yapılmış
olması, Tuna'nın NFR Products kurucu ortaklığı (yarışma-parça pazarını içeriden tanıma),
iki kişilik teknik ekip (Hüseyin mekanik / Tuna yazılım), impact.tr ilişkisi.
- Bunlar TON'u besler (üretici merakı, sahayı tanıma), ama ilk mailde sosyal-kanıt olarak
  DAYATILMAZ. Kanon zaten uzun kurucu hikâyesini gövdeden çıkarıyor. Gerekiyorsa en fazla tek
  yüzeysel dokunuş, o da doğrulanmışsa.

## İmza (sabit — değiştirme)
```
Tuna
probotstudio.com · 0538 040 81 48
```

## Raporun zayıf kaldığı yerler (bilerek boş bırak / TODO)
- Gerçek gönderim/cevap/ret kaydı YOK → "şu mail çalıştı" tarzı çıkarım yapma.
- Diğer dosyalardaki "kanonik/DEĞİŞMEZ" eşikler (80 kelime gövde, konu çerçevesi 2–4 kelime,
  +4/+5 takip ritmi) veriyle KANITLANMIŞ optimum değildir; writer'ı tutarlı ve güvenli tutmak
  için konmuş editoryal varsayılanlardır. Gönderim/cevap verisi biriktikçe revize edilebilir —
  ama o veri gelene dek writer bunlara harfiyen uyar (gevşetme yetkisi Tuna'da).
- Fiyat, BOM, elektronik, teslimat sayıları belirsiz → hepsi TODO.
- Ekip/referans detayları iç kaynaklı, dış teyit yok → mailde iddiaya çevirme.
