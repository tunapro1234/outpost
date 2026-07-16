# SPEC-GATHER2 — Gather v2 taksonomi + Copilot tmux köprüsü (2026-07-16)

Tuna steer'inden türetilen karar (Fable): matris yok. "Şirket derinleştirme" ayrı kavram değil —
Discover People'ın şirket-kaynaklı hali. Şirketsiz insanlar (eğitimci vb.) da Discover People'a girer.

## 1. Taksonomi (kesin)

Her gather agent görevi tek bir `kind` taşır:

| kind | anlamı | örnek |
|------|--------|-------|
| `discover-company` | Yeni şirket bul + ekle (genişletme) | web araması, dizinler |
| `discover-person`  | Yeni insan bul + ekle. İki kaynak modu: `source: company` (bir şirketin çalışanları = eski "şirket derinleştirme") veya `source: standalone` (şirketsiz — eğitimci, freelancer; serbest arama brief'i) | takım sayfası, LinkedIn, arama |
| `enrich`           | VAR OLAN şirket/kişilerin eksik alanlarını doldur (derinleştirme) | mail, telefon, rol, sosyal |

## 2. Backend kontratı (server/modules/gather)

- Agent tanımına (`agents.yaml` + repo içi `*.agent.yaml` şablonları) zorunlu `kind` alanı,
  `discover-person` için opsiyonel `source: company|standalone` + `target`/`brief` paramları.
  `kind` eksikse geriye-uyum: `enrich` varsay.
- Mevcut site-scanner → `kind: enrich` (site'ten mail buluyor).
- Yeni şablonlar (hepsi `enabled: false`, `schedule: manual`):
  - `company-scout.agent.yaml` — discover-company (web search, luna classify → stage)
  - `people-finder.agent.yaml` — discover-person, source: company (şirket site/takım sayfası)
  - `person-scout.agent.yaml` — discover-person, source: standalone (`brief` paramı)
- **Yeni endpoint** `GET /api/ws/:ws/gather/overview` →
  ```json
  { "agents": [{ "id","name","kind","source?","enabled","status","currentTask","lastRunAt","lastRunSummary","stagedCount" }],
    "counts": { "discover-company": {"staged":0,"accepted":0}, "discover-person": {...}, "enrich": {...} } }
  ```
  `status`: `running` (aktif run — runner/scheduler state'inden) | `idle` | `error` (son journal kaydı fail).
  `currentTask`: koşan run'ın kısa açıklaması (ör. "acme.com taranıyor"), yoksa null.
- Stage kayıtlarına `kind` propagate edilir (üreten agent'tan; eskilerde yoksa enrich say).
- Mevcut route'lar/testler bozulmaz; yeni davranışa test eklenir.

## 3. UI kontratı (web/src/modules/gather/GatherView.tsx)

- Header sekmeleri: **Discover Companies · Discover People · Enrich** (EN).
- Sekmelerin ÜSTÜNDE her zaman görünür **Agents şeridi**: TÜM agentlar (kind fark etmez),
  canlı durum noktası (running=yeşil pulse, idle=gri, error=kırmızı), o anki görev metni;
  overview endpoint'i 5 sn'de bir poll. Tıklayınca agent detayı (son run'lar / journal).
- Her sekme: o kind'ın agent kartları (kaynak→agent→stage→vault akışı, mevcut canvas dili
  korunabilir/sadeleştirilebilir — Opus takdiri) + o kind'a filtreli staging review (accept/reject aynen).
- Discover People sekmesi iki grup: **From company** (hedef şirket seçimi) ve **Standalone**
  (serbest brief, ör. "STEM eğitmenleri İstanbul").
- Dark + white tema, 0 console error, `npm run build` yeşil.

## 4. Copilot tmux köprüsü (server/modules/copilot)

Amaç: copilot cevaplarını headless claude yerine kalıcı tmux agent'ı **outpost-copilot** versin
(tool erişimi var → vault'u gerçekten sorgulayabilir).

Protokol (v1, dosya-tabanlı):
- Env `OUTPOST_COPILOT_TMUX` (default `outpost-copilot`). `tmux has-session` başarısızsa
  mevcut headless runner'a sessiz fallback (runner.mjs aynen kalır).
- İstek: `id = cp-<epochms>-<4hex>`; tam prompt (workspace context + soru + geçmiş)
  `<wsdir>/copilot/inbox/<id>.md` dosyasına yazılır.
- Meşguliyet: `tmux capture-pane -p | tail -5` içinde `esc to interrupt` → meşgul;
  2 sn'de bir, en çok 20 sn bekle; hâlâ meşgulse headless fallback (log'la).
- Gönderim: `tmux send-keys -t <session> -l '<tek satır>'` + AYRI `send-keys Enter`.
  Satır: `[copilot <id>] Soru: copilot/inbox/<id>.md oku; cevabı copilot/outbox/<id>.md dosyasına markdown olarak yaz; bitince copilot/outbox/<id>.done oluştur.`
- Stream: outbox dosyasını 500 ms'de bir poll et, eklenen baytları mevcut SSE'ye aktar;
  `.done` görülünce kalanı gönderip bitir. Timeout 180 sn → hata mesajı.
- Yeni dosya `tmux-bridge.mjs`; routes önce köprüyü dener. inbox/outbox dosyaları silinmez (journal).
