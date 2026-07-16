# Outpost UI v2 (Tuna steer'i, 2026-07-16)

Tuna'nın geri bildirimi (v1 canlı sonrası) — hepsi ZORUNLU:

1. **Tema (Tuna rev, 2026-07-16): DARK default ama LACİVERT DEĞİL** — mevcut #0b0f1a mavi tınısından
   memnun değil. Nötr siyah/gri skalada kal: zemin ~#0e0e10 / yüzeyler ~#17171a / çizgiler ~#26262a
   gibi renksiz (hue'suz) griler; mürekkep açık gri-beyaz. Tip renkleri yeniden tasarlanır:
   doygunluğu terbiyeli, nötr zeminde net ayrışan, "neon oyuncak" durmayan bir palet.
   Ek olarak temiz bir BEYAZ tema toggle'ı da olsun (sağ üst, localStorage; Tuna önce beyaz istedi,
   sonra nötr-dark dedi — ikisi de elinin altında olsun, default: nötr dark).
2. **Performans** ("biraz kasıyor", 1.864 düğüm): simülasyon settle olunca DURDUR (cooldownTicks
   sınırı + engine stop; yeniden ısıtma sadece filtre/fizik değişiminde), label culling (zoom +
   degree eşiği), kenarları düşük alpha tek geçişte çiz, hit-test için pointer alanını node'larla
   sınırla, gereksiz React re-render'ları kes (graph data memoize, panel state'i grafı yeniden
   kurmasın). Filtre uygulanınca sadece görünen alt-küme force'a girsin.
3. **Vurgu davranışı**: hover çok hassas → (a) TIKLAMA ana mekanizma: tık = seç + komşuluk vurgusu
   KALICI; (b) hover vurgusu 200ms gecikmeli açılır, pointer node'dan çıkınca 300ms bekleyip söner
   (grace period), hit yarıçapı cömert. Boşluk tıkı seçimi temizler (mevcut davranış).
4. **Sol panel — "Ağ Paneli", HER ZAMAN AÇIK, boyutlanabilir** (sürükleme kulpu, genişlik
   localStorage; dar ekranda collapse edilebilir ama default açık). İçerik bölümleri (akordeon):
   - **Filtreler** (aşağıda §Filtreleme)
   - **Fizik** (aşağıda §Fizik)
   - **Lejant + istatistik** (mevcut sol-alt kutu buraya taşınır; görünen/toplam, kenar sayısı)
   Sağdaki entity paneli aynı kalır (o da boyutlanabilirse artı puan).
5. **Görünümler / navigasyon**: üst barda sekmeler: **Ağ** (graf), **Mailler**, **Entegrasyonlar**.
   - **Mailler**: `GET /api/mails` (server v1.1) → tablo: tarih, yön (→ giden / ← gelen), kişi
     (tık → Ağ görünümünde o node seçili), özet/konu. Yön filtresi + arama + tarih sıralama.
     Boş durum: "Henüz mail kaydı yok". (İleride gönderim pipeline'ı buraya gelecek — v2'de YOK,
     sadece okuma.)
   - **Entegrasyonlar**: kart grid'i, her kart: ad, açıklama, durum rozeti. Durumlar:
     `bağlı` (yeşil) / `planlandı` (gri) / `yapılandır` (sarı). İçerik statik config
     (`src/integrations.ts`): Merkezi Browser Sunucusu (bağlı — paylaşımlı Playwright,
     scraper modülü kullanıyor), Gitea (bağlı — repo tunapro/outpost), Mail gönderimi
     (planlandı — insan onaylı pipeline), Mail doğrulama Hunter/ZeroBounce/Prospeo (planlandı),
     Google Places (planlandı — keşif kaynağı), Serper.dev (planlandı — SERP), Obsidian vault
     (bağlı — veri kaynağı). Kart tıkları şimdilik detay modalı (açıklama + "yakında" notu).
6. **Fizik slider'ları** (Ağ Paneli > Fizik): charge (itme kuvveti), link mesafesi, gravity
   (merkeze çekim), collision yarıçap çarpanı, hız sönümü (velocityDecay); + "Dondur/Çöz" butonu
   (simülasyonu durdur/başlat) + "Sıfırla". Değerler localStorage'da kalıcı. Slider oynarken
   simülasyon yeniden ısınır, bırakınca settle edip durur.

## §Filtreleme (v2'nin kalbi — güçlü, birleşebilir)

Tüm filtreler AND ile birleşir; hepsi tek `FilterState` objesi, URL query'ye encode edilir
(paylaşılabilir link) ve localStorage'a son durum yazılır.

- **Metin**: TR-normalize substring/fuzzy (ad + hook + city içinde arar; alan seçilebilir).
- **Tip**: mevcut 5 chip (sayaçlı).
- **Alt-tip**: tipe göre gruplu çoklu-seç (facet sayaçlı; `GET /api/facets`'ten).
- **Durum**: çoklu-seç + "durumu olmayanlar" seçeneği.
- **Skor**: min-max çift uçlu slider + "skorsuzları dahil et" checkbox.
- **Derece (bağlantı sayısı)**: min-max; "izole düğümleri gizle" kısayol toggle'ı.
- **Şehir/ilçe**: facet çoklu-seç.
- **Mail**: var / yok / kaynağa göre (yayimlanmis | pattern | info).
- **Yakınlık** (kişi): 0-5 aralık.
- **Kenar türü**: relation / mention görünürlük toggle'ları (mention default kapalı — performans
  ve okunurluk; lejantta belirt).
- **Komşuluk modu (ego ağı)**: seçili düğümden N adım (slider 1-3) — "sadece bunun çevresini
  göster" butonu entity panelinde de olsun. Aktifken üstte bilgi şeridi: "X'in 2-adım çevresi ·
  Çık".
- **Hub sönümleme**: derecesi eşik üstü düğümleri işaretle (görsel küçültme + label önceliği);
  "hub'ları gizle" toggle (eşik slider, default p99).
- **Preset'ler**: mevcut filtre durumunu adla kaydet (localStorage), listeden uygula/sil.
  Hazır gelen 3 preset: "Hedefler" (company+institution+school, skor≥15), "Sıcak" (status:
  gonderildi/cevap/randevu), "Ağ omurgası" (derece≥5).

Filtre değişince: graf alt-kümesi yeniden hesaplanır (client-side; tam graf zaten bellekte),
sayaçlar güncellenir, simülasyon kısa re-heat + settle + stop. Liste görünümü de aynı
FilterState'i kullanır.

## Server v1.1 ekleri (ayrı iş, GPT)

- `GET /api/facets` → `{subtypes:{person:{kurucu:12,...},company:{...},...}, statuses:{aday:187,...},
  cities:{"İstanbul":40,...}, mail_sources:{yayimlanmis:33,...}, degree:{max:412,p99:57}}`
- `GET /api/mails` → `[{person_id, person_name, date:"2026-07-14", direction:"out"|"in",
  summary:"...", raw:"- 2026-07-14 → giden: ..."}]` — people dosyalarındaki `## Mailler`
  bölümünden parse (satır formatı: `- <tarih> → giden: <metin>` / `- <tarih> ← gelen: <metin>`;
  format dışı satır: date null, direction "out"/"in" tahminsiz "unknown", raw korunur). Tarih desc.
- İkisi de indeksten türetilir (watcher zaten var), ekstra I/O yok.

## Kalite çıtası
- 1.864 düğümde: açılış < 2sn'de okunur görünüm, pan/zoom akıcı (settle sonrası fizik kapalı).
- Işık temada screenshot iterasyonu ZORUNLU (canlı veriyle, en az 2 tur; açılış + seçili + Mailler
  + Entegrasyonlar + filtre paneli açık durumları).
- `npm run build` 0 TS hatası; console 0 error.
- Mevcut özellikler bozulmaz: arama, ?select=, liste, entity PATCH, klavye kısayolları.
