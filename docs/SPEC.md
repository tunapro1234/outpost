# Outpost SPEC v1 (sözleşme — tüm implementasyon buna uyar)

Outpost = graf-merkezli outreach aracı. Veri = markdown vault (Obsidian uyumlu).
Sunucu vault'u parse eder, graf + REST API verir, web UI'ı serve eder.

Monorepo, ama paketler BAĞIMSIZ (workspaces yok): `server/` `web/` `scraper/` her biri kendi
package.json + package-lock.json + node_modules'üyle. Node 22, ESM. TypeScript zorunlu değil
(server düz JS olabilir); web Vite+React+TS.

## 1. Veri modeli (vault)

Vault dizini: env `OUTPOST_VAULT` (default `./data/vault`). Klasör = tip:

```
people/ companies/ institutions/ schools/ channels/
```

Tipler ve UI etiketleri: `person`=Kişi, `company`=Şirket, `institution`=Kurum, `school`=Okul,
`channel`=Kanal. Dosya adı = slug (NFKD ascii, Türkçe ş→s ğ→g ı→i ö→o ü→u ç→c, boşluk→`-`).
Entity id = slug (tipten bağımsız benzersiz; çakışırsa `-2` eki).

### Frontmatter (YAML)
Ortak: `type` (zorunlu), `name` (zorunlu, görünen ad), `subtype` (serbest: atolye, kolej,
bilim-merkezi, tedarikci, vakif, devlet, universite, lise, yarisma, fuar, dernek, topluluk, takim,
kurucu, egitmen, mudur...), `status` (aday | arastirildi | taslak | onay-bekliyor | gonderildi |
cevap | randevu | red | pas — boş olabilir), `score` (number|null), `city`, `district`,
`mail`, `mail_source` (yayimlanmis|pattern|info|yok), `phone`, `whatsapp`, `site`, `instagram`,
`linkedin`, `hook` (kişiselleştirme kancası), `source_url`, `found_date` (KVKK izi),
`tags` (liste, ops.).
Person'a özel: `closeness` (0-5), `role`, `alumni_school`, `alumni_year`, `alumni_dept`.
Bilinmeyen frontmatter alanları KORUNUR (yazarken kaybolmaz).

### Body
- İlk paragraf: tanım (2-3 cümle).
- `## İlişkiler` — her satır bir kenar: `- [[Hedef Adı]] — ilişki etiketi` (etiket serbest:
  kurucusu, çalışıyor, mezunu, sponsor, takipleşiyor, aynı yarışmada...).
- Diğer bölümler serbest (`## Outreach`, `## Mailler`, `## Notlar`...) — aynen korunur.

### Kenar çıkarımı
- `## İlişkiler` satırları → kind=`relation`, label'lı, yönlü (dosya → hedef).
- Body'nin başka yerindeki `[[wikilink]]`ler → kind=`mention` (label yok).
- Hedef çözümleme: `[[X]]` önce name tam eşleşme (case-insensitive), sonra slug eşleşme.
  Çözülemeyen hedef → node oluşturulmaz, entity detayında `unresolved` listesinde raporlanır.
- Aynı çift arasında relation varsa mention bastırılır (dupe kenar yok).

## 2. Server (`server/`)

Fastify (veya express — tercih serbest, hafif olsun). Port: env `OUTPOST_PORT` (default 3002),
sadece 127.0.0.1'e bind. In-memory indeks: açılışta vault taranır (gray-matter ile parse),
chokidar ile dosya değişiminde artımlı güncelleme. GET'ler indeksten, ucuz.

### REST API (hepsi JSON; hata: `{error: "mesaj"}` + uygun HTTP kodu)
- `GET /api/graph?types=a,b&statuses=x,y&minScore=n&q=str`
  → `{nodes:[{id,name,type,subtype,status,score,degree}], edges:[{source,target,label,kind}]}`
  Filtreler node'ları kısıtlar; kenarlar iki ucu da görünür node'lara bağlı olanlardır.
  `q`: name substring (TR-normalize edilmiş, case-insensitive).
- `GET /api/entities?type=&status=&q=&sort=score|name|degree&order=asc|desc`
  → `[{id,name,type,subtype,status,score,city,mail,degree}]`
- `GET /api/entities/:id`
  → `{id, meta:{<tüm frontmatter>}, body:"<markdown>", relations:[{id,name,type,label,kind,direction:"out"|"in"}], unresolved:["ad",...]}`
- `PATCH /api/entities/:id` — gövde: `{meta?:{k:v,...}, body?:"..."}`. meta partial merge
  (null → alan silinir), body verilirse tamamen değişir. Dosya diske yazılır (frontmatter
  alan sırası + bilinmeyen alanlar korunur). Dönüş: güncel entity (GET formatı).
- `POST /api/entities` — `{type, name, meta?, body?}` → oluşturur, 201 + entity. Slug çakışırsa `-2`.
- `DELETE /api/entities/:id` → dosyayı `<vault>/.trash/` altına taşır (gerçek silme yok).
- `GET /api/stats` → `{total, byType:{}, byStatus:{}, edgeCount}`
- `GET /healthz` → `{ok:true, vault:"<path>", entities:n}`
- `/` ve statik: `web/dist` serve edilir (yoksa "UI build edilmemiş" mesajı).

### Importer (`server/importer.mjs`)
CLI: `node server/importer.mjs <kaynak-vault> <hedef-vault>`. Kaynak = probot outreach vault
(salt-okunur; ASLA yazma). Eşleme:
- `kisiler/` (tip: kisi) → `people/` type=person; `rol`→`role`, `yakinlik`→`closeness`,
  `mezuniyet-okul/yil/bolum`→`alumni_*`, `mail-kaynak`→`mail_source`.
- `okullar/` (tip: okul) → `schools/`.
- `kanallar/` (tip: kanal) → `channels/`.
- `kurumlar/` (tip: kurum) kategoriye göre: atolye|tedarikci → `companies/`;
  bilim-merkezi|vakif|devlet → `institutions/`; kolej → `schools/` (subtype=kolej).
  Bilinmeyen/boş kategori → `companies/` + rapora yaz.
- `kategori`→`subtype`, `sehir`→`city`, `ilce`→`district`, `kanca`→`hook`, `durum`→`status`,
  `skor`→`score`, `tel`→`phone`. Diğer alanlar aynen taşınır. Body ve wikilinkler DEĞİŞMEZ
  (hedef çözümleme name üzerinden çalıştığı için link kırılmaz).
- `00-*.md` MOC dosyaları taşınmaz. Sonda rapor: sayılar, kategori dağılımı, atlanan dosyalar.

### Örnek vault (`example-vault/`)
Geliştirme/demo için 12-15 uydurma entity (her tipten, ilişkili, Türkçe adlar, gerçek kişi YOK).
Testler bunun üzerinde koşar.

### Testler
node:test ile: parser (frontmatter+ilişki çıkarımı), slug (Türkçe), graph endpoint filtreleri,
PATCH round-trip (bilinmeyen alan korunumu), importer eşlemesi (mini fixture). `npm test` yeşil olacak.

## 3. Scraper (`scraper/`)

KENDİ Chromium'unu KURMAZ. Merkezi browser sunucusuna bağlanır:
`chromium.connect('ws://127.0.0.1:3333/' + TOKEN)`, TOKEN = `/srv/browser/.ws_token` dosyasından
runtime'da okunur (env `BROWSER_WS` ile override). TOKEN asla loglanmaz/commitlenmez.
playwright sürümü **1.61.1'e sabit** (sunucuyla uyum), `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` ile kurulur.

- `scraper/lib.mjs`: `connectBrowser()`, `newHumanContext(browser)` (TR locale, Europe/Istanbul,
  gerçekçi UA/viewport), `humanDelay(min,max)`, `politeGoto(page,url)` (2-5sn insan-hızı bekleme).
- `scraper/fetch.mjs <url>`: sayfayı aç → `{url,title,text(ilk 5000 char),links[]}` JSON stdout,
  screenshot `scraper/out/<slug>.png`.
- `scraper/smoke.mjs`: (1) bot.sannysoft.com → test tablosunu oku, passed/failed listesi stdout;
  (2) news.ycombinator.com başlığı. Sonda `SMOKE OK` ya da `SMOKE FAIL: <neden>`.
- Her script sonunda `browser.close()`. README: kullanım + kurallar (login'li scraping yok,
  SMTP probe yok, düşük rate).

## 4. Deploy (`deploy/`)

- `outpost.service` (systemd): `node server/index.mjs`, WorkingDirectory repo, env
  `OUTPOST_VAULT=/srv/outpost/data/vault OUTPOST_PORT=3002`, Restart=always.
- `nginx-outpost.conf`: outpost.tunapro.xyz → proxy 127.0.0.1:3002; basic auth
  (`auth_basic_user_file /etc/nginx/.htpasswd-outpost`) — veri kişisel iletişim içeriyor (KVKK),
  public bırakılamaz. certbot SSL.
- `DEPLOY.md`: adımlar (DNS → certbot → vhost → systemd). ports.md kaydı: 3002.

## 5. Sabit kurallar (koda gömülü varsayım OLMAZ)
- Probot'a özgü hiçbir şey hardcode edilmez (domain, imza, mail adresi).
- İnsan onayı olmadan mail gönderimi yok (v1'de gönderim YOK zaten — sadece veri+graf).
- `/srv/probot/**` her zaman salt-okunur muamele görür.
- Secrets (.ws_token, htpasswd, .env) repoya girmez; `.gitignore`: `node_modules`, `data/`,
  `dist/`, `out/`, `.env*`.
