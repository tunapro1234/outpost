# SPEC-AGENTS-ROLES — personal agent + workspace main agent + feedback entegrasyonu (2026-07-17)

Tuna goal'ünden. Üç karar:

## 1. Feedback ≠ sadece dışlama
Reject nedenleri sisteme DAVRANIŞ olarak işler:
- `bad-content` + not → kişi kuyruğa geri döner (mail_state=none) ve writer bir SONRAKİ taslağında
  o kişinin geçmiş red notlarını prompt'a koyar ("önceki taslak şu nedenle reddedildi: ...").
  Stil içerikli notlar ayrıca kullanıcı profiline (dashboards/<user>.json notes.mail_prefs) işlenir
  (personal agent yapar).
- `exclude-company` → yapılandırılmış denetim: outreach: excluded + outreach_by/at/reason.
  GET /api/ws/:ws/exclusions listeler; DELETE /api/ws/:ws/exclusions/:companyId override eder
  (override da feedback.jsonl'e kim/ne zaman/neden ile yazılır). UI: Reach'te Exclusions paneli
  (kim, ne zaman, neden + Remove) ve entity sayfasında banner.
- Tüm feedback mails/feedback.jsonl'de (curator hammaddesi).

## 2. Personal agent (hesap başına 1, sonnet-5) — YETKİ SINIRLARI
- Oturum: op-ws-<kod>-usr-<ad-soyad> (mevcut altyapı). **Copilot çekmecesinin yerini alır**: UI'da tek
  çekmece "Assistant"; eski Copilot butonu/çekmecesi kalkar (owner dahil herkes kendi personal
  agent'ıyla konuşur).
- YAPABİLİR (kendi kullanıcısı adına, X-Remote-User header'lı curl ile):
  - PUT /dashboard (kendi düzeni + notes.mail_prefs)
  - POST /maildrafts/:id/reject (nedenli; exclude-company dahil)
  - DELETE yok (exclusion override edemez — o owner/main agent işi)
  - Vault/stage OKUR, yazamaz.
- YAPAMAZ: maildrafts approve (mail çıkışına giden her şey), agents.yaml/hız, servis, git.
  Sunucu tarafında zorlanır: approve endpoint'i yalnız role=owner (users.yaml) kabul eder.
- Bilmediği/yetkisini aşan konularda workspace main agent'a sorar (aşağıdaki protokol).

## 3. Workspace main agent (workspace başına 1, opus) — YETKİLİ
- Oturum: op-ws-<kod> (probot için: mevcut outpost-copilot yeniden adlandırılıp
  re-brief edilir — zaten opus + vault bağlamı var). bp kaydı güncellenir (ada'ya haber).
- Görevleri: (a) workspace sağlığı — pipeline koşuları, hatalar, birikimler; (b) kullanıcı
  personal agent'larından gelen bilgileri MERGE etmek (ör. "şu kurumu tanıyoruz" → vault
  güncellemesi/exclusion); (c) personal agent'ların soru mercii; (d) sistem ayarı (agent
  hızları PATCH, skills güncelleme önerisi, exclusion override).
- Yetkileri: workspace içinde geniş (vault düzenleme, PATCH /agents, exclusion yönetimi).
  SINIR: mail GÖNDERemez (o hâlâ yalnız Tuna onayı + ileride dispatch kararı) ve
  /srv/outpost/outpost repo koduna dokunmaz (kod işi outpost-main'in).
- Copilot backend'i (POST /copilot) artık bu oturuma bağlanır (OUTPOST_COPILOT_TMUX=op-ws-prb)
  — API geriye uyumlu kalır; UI'da ayrı Copilot yüzeyi kalksa da owner API'den konuşabilir.

## Agent-arası protokol (personal → main)
Personal agent sorusunu şöyle iletir (tmux üzerinden, kendi brief'inde yazar):
`tmux send-keys -t op-ws-<kod> -l '[ask <user> <id>] Soru: assistant/<user>/ask/<id>.md; cevap: assistant/<user>/ask/<id>.answer.md (+.done)'` + Enter.
Main agent cevabı dosyaya yazar; personal agent .done bekler. Meşgulse bekler (capture-pane).
Main agent kendi brief'i: <workspace>/main-agent/CLAUDE-MAIN.md (repo şablonu
server/modules/assistant/main-agent-brief.md).
