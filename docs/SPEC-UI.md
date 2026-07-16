# Outpost UI SPEC v1 (`web/`)

Hedef kitle: Tuna (kurucu) — outreach ağını graf üzerinden yönetir. Eski araç (admin panel,
tablo-merkezli) bilinçli olarak UNUTULDU; bu UI sıfırdan, **graf merkezde**.

## Stack
- Vite + React + TypeScript. Graf: `react-force-graph-2d` (canvas; ~500-2000 node akıcı).
- Her şey bundle'a gömülü — runtime'da CDN/dış istek YOK (font dahil; sistem font stack kullan).
- `npm run build` → `web/dist` (server bunu serve eder). `npm run dev` → Vite proxy `/api` → 127.0.0.1:3002.
- Mock modu: `VITE_MOCK=1` iken `web/mock/graph.json` + `web/mock/entities.json`den beslenir
  (API şekli SPEC.md §2 ile birebir) — server hazır olmadan geliştirme için.

## Düzen
Tam-viewport tek sayfa. Bileşenler:

1. **Graf (merkez, tüm ekran)** — force-directed.
   - Node rengi = tip (5 tip; koyu zeminde ayırt edilebilir, aşağıda). Node boyutu = degree
     (min-max clamp'li). Label: zoom eşiğinden sonra ad görünür; seçili/hover node'un adı hep görünür.
   - Hover: komşuları vurgula, gerisini soluklaştır. Tık: seç → sağ panel açılır, komşuluk vurgusu
     kalıcı. Boşluğa tık: seçim temizlenir. Çift tık: node'a zoom.
   - Kenar: relation = düz çizgi (hover'da label tooltip), mention = daha soluk/ince.
   - Status görselleştirme: node dış halkası status rengiyle (gonderildi/cevap/randevu gibi
     ilerlemiş statüler sıcak tonlar) — bakışta "kime ulaşıldı" okunur.

2. **Üst bar** — sol: "Outpost" logotype (metin yeterli, zevkli). Orta: arama (fuzzy, TR-normalize;
   sonuç listesinden seçince node'a zoom + seç). Sağ: görünüm anahtarı (Graf | Liste).

3. **Filtre şeridi** (üst barın altında, ince): tip chip'leri (renkli, sayaçlı, çoklu-seç toggle),
   status çoklu-seç, min-skor slider. Filtre grafiği VE listeyi etkiler (API paramlarıyla).

4. **Sağ panel (seçimde açılır, ~380px, kapatılabilir)** — entity kartı:
   - Ad, tip rozeti, subtype, şehir/ilçe.
   - Status: renkli pill, tıklayınca dropdown → değişince `PATCH /api/entities/:id` (meta.status).
   - Skor, closeness (kişiyse, 0-5 nokta göstergesi).
   - İletişim: mail (mailto, yanında mail_source etiketi), telefon (tel:), site / instagram /
     linkedin (yeni sekme). Boş alan gösterilmez.
   - `hook` varsa alıntı kutusu ("kanca").
   - İlişkiler listesi: `→/←` yön, etiket, hedef adı (tık → o node'a git). Unresolved ayrı soluk grup.
   - Body: markdown render (frontmatter hariç). Hafif bir md renderer kullan (marked vb., bundle'da).
   - Alt: "Notu düzenle" → body textarea + kaydet (PATCH body).

5. **Liste görünümü** (toggle): tablo — ad, tip, subtype, status, skor, şehir, mail, degree;
   başlıktan sıralama; satır tık → entity seç (panel açılır; Graf'a dönünce o node odaklı).
   Yeni entity: listede "+ Yeni" → mini form (tip, ad) → POST.

6. **Sol alt köşe**: lejant (tip renkleri) + toplam sayılar (stats API).

## Görsel dil
- Koyu tema default (tek tema yeterli v1'de). "Operasyon odası" hissi: derin lacivert-siyah zemin
  (#0b0f1a civarı), yüksek kontrast metin, tek accent. Ciddi, temiz, oyuncak değil.
- Tip renkleri (koyu zemin için): person #5ba8f5 · company #f5a623 · institution #a78bfa ·
  school #34d399 · channel #f472b6. Status halka renkleri: aday/arastirildi nötr gri-mavi,
  taslak/onay-bekliyor sarı, gonderildi turuncu, cevap/randevu yeşil, red/pas koyu kırmızı/gri.
- UI dili Türkçe (Kişi, Şirket, Kurum, Okul, Kanal; Durum, Skor, İlişkiler...).
- mdash kullanma; boş durumlar için sade mesajlar ("Henüz seçim yok — graftan bir düğüm seç" gibi değil,
  kısa: "Bir düğüm seç").

## Kalite çıtası
- 500 node'da akıcı pan/zoom. İlk yüklemede graf 1sn içinde görünür (spinner değil, fade-in).
- Klavye: `/` arama odağı, `Esc` panel kapat.
- `npm run build` sıfır TS hatasıyla geçer. Console'da runtime hatası yok.
- Responsive minimum: 1280px+ masaüstü hedef; mobilde kırılmasın yeter (optimize gerekmez).
