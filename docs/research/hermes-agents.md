# Hermes tarzı kalıcı agent yapıları — araştırma raporu

**Tarih:** 17 Temmuz 2026  
**Kapsam:** 2025–2026; araştırma yapan ve kişiselleştirilmiş outreach e-postaları hazırlayan agentlar.

## Kısa sonuç

“Uzun süre çalışan agent”, pratikte aynı LLM konuşmasının haftalarca açık kalması demek değil. Sağlam sistemler:

1. Her işi sınırlı/fresh bir context içinde çalıştırıyor.
2. Durumu dosya, SQL/veritabanı ve checkpoint’lerde saklıyor.
3. Yalnızca ilgili küçük bir bölümü sonraki context’e geri çağırıyor.
4. Eski konuşmaları özetleyip arşivliyor.
5. Gönderme gibi geri döndürülemez işlemleri ayrı izin katmanına koyuyor.

Nous Research’ün **Hermes Agent**’ı bu yaklaşımın güncel, açık kaynak bir örneği. Fakat Hermes’in kendi cron sistemi bile işleri **fresh ve izole session’larda** çalıştırıyor. Dolayısıyla mevcut tmux + cron yapınız temelden yanlış değil; en mantıklı yön, onu kalıcı ama küratörlü bir bellek ve durable task-state ile güçlendiren hibrit mimari.

---

## 1. “Hermes” adı neye karşılık geliyor?

### A. Nous Research Hermes model ailesi

Hermes 3/4, Nous Research’ün instruction-following, reasoning ve tool-use için eğitilmiş açık ağırlıklı **LLM ailesi**. Tek başına scheduler, kalıcı bellek veya 24/7 agent runtime değildir.

- 2025’te yayımlanan Hermes 4 ailesinde 14B, 70B ve 405B sürümleri bulunuyor: [Hermes 4 koleksiyonu](https://huggingface.co/collections/NousResearch/hermes-4-collection)
- Teknik rapor modelin eğitim ve değerlendirmesini anlatıyor: [Hermes 4 Technical Report](https://nousresearch.com/wp-content/uploads/2025/08/Hermes_4_Technical_Report.pdf)

**Sonuç:** “Hermes modeli kullanıyoruz” ile “Hermes Agent çalıştırıyoruz” farklı şeyler. Agent harness’i başka modellerle de çalışabiliyor.

### B. Nous Research Hermes Agent

2026’da öne çıkan, MIT lisanslı ve model-bağımsız Python agent harness’i. Aktif geliştiriliyor; Temmuz 2026 itibarıyla güncel release akışı mevcut: [resmî repo](https://github.com/NousResearch/hermes-agent), [release geçmişi](https://github.com/NousResearch/hermes-agent/releases).

Başlıca özellikleri:

- CLI, sunucu/VPS ve mesajlaşma gateway’leri
- Web, terminal, dosya, browser ve MCP araçları
- Kalıcı kullanıcı/agent belleği
- Geçmiş session araması
- Context sıkıştırma ve session continuation
- Cron, batch ve job chaining
- İzole subagent’lar
- Deneyimden tekrar kullanılabilir skill üretme/güncelleme
- Checkpoint ve rollback

Agent belirli bir Hermes modeline bağlı değil; farklı inference sağlayıcıları ve yerel modeller kullanılabiliyor. Bu nedenle Hermes Agent’ı bir **runtime/harness**, Hermes 4’ü ise olası bir **inference modeli** olarak düşünmek doğru.

### C. Hermes Agent Cloud ve üçüncü taraf barındırma ürünleri

Nous’un kendi portalında always-on cloud sürümü tanıtılıyor: [Hermes Agent Cloud](https://portal.nousresearch.com/cloud).

Ayrıca HermesOS, Donely, xHermes ve DeployHermes gibi Nous stack’ini yönettiğini iddia eden üçüncü taraf servisler var. Bunların çoğu 2026’da ortaya çıkmış çok yeni ürünler.

- [HermesOS yol haritası](https://hermesos.cloud/roadmap/HermesOS_Roadmap_2026.pdf)
- [xHermes dokümantasyonu](https://www.xhermes.cloud/docs)
- [DeployHermes Product Hunt kaydı](https://www.producthunt.com/products/deployhermes)

Bunların uptime, güvenlik, “self-healing”, model sürümü ve kurumsal uyumluluk iddialarını doğrulayan yeterli bağımsız kanıt bulamadım. Üretim seçimi yapmadan önce veri lokasyonu, subprocess izolasyonu, secret yönetimi, audit log ve exit/export imkânları ayrıca incelenmeli.

### D. İsim benzerliği olan ilgisiz “HERMES” projeleri

2025–2026 literatüründe aynı adı kullanan matematiksel ispat, robotik, otonom sürüş, video tespiti ve telekom agent projeleri de var. Örneğin telekom ağları için “blueprint” üreten çok-agentlı HERMES başka bir projedir: [makale](https://arxiv.org/abs/2411.06490).

Bunlar outreach/personal assistant anlamındaki Hermes Agent ile aynı ürün veya kod tabanı değil.

---

## 2. Kalıcılık ve context yönetimi

### Tipik bellek hiyerarşisi

| Katman | İçerik | Saklama/çağırma biçimi |
|---|---|---|
| Çalışma belleği | Son mesajlar, mevcut plan, açık tool sonuçları | Aktif context window |
| Core/semantic bellek | Kullanıcı tercihleri, ICP, marka tonu, sabit gerçekler | Küçük ve sürekli prompt’a eklenen dosya/blok |
| Task state | Lead, tamamlanan adım, retry, kaynak listesi | SQL/JSON/checkpoint |
| Episodic bellek | Önceki run’lar, kararlar, sonuçlar | Session logları; gerektiğinde arama |
| Procedural bellek | SOP, prompt, başarılı araştırma/yazım yöntemleri | Versiyonlu skill/dosya |
| Arşiv | Web çıktısı, büyük belgeler, ham kanıt | Dosya/object store; FTS/vector/hybrid retrieval |

LangGraph bunu kısa dönem thread state ile semantic, episodic ve procedural uzun dönem bellek olarak ayırıyor; bellek yazımı görev sırasında veya arka planda yapılabiliyor: [LangGraph memory overview](https://docs.langchain.com/oss/python/concepts/memory). Checkpoint’ler resume, hata toleransı ve human-in-the-loop sağlıyor: [persistence dokümanı](https://docs.langchain.com/oss/python/langgraph/persistence).

Letta/MemGPT yaklaşımı context’i RAM gibi, dış belleği disk gibi ele alıyor. Küçük “memory block”lar context’e pinlenirken tam konuşma ve arşiv ayrı saklanıyor: [Letta memory blocks](https://www.letta.com/blog/memory-blocks/), [agent memory mimarisi](https://www.letta.com/blog/agent-memory/).

### Hermes Agent özelinde

Hermes’in temel kalıcı belleği oldukça küçük ve bilinçli olarak sınırlı:

- `MEMORY.md`: yaklaşık 2.200 karakter
- `USER.md`: yaklaşık 1.375 karakter
- Session başında system prompt’a frozen snapshot olarak ekleniyor.
- Limit aşılırsa sessizce kesmek yerine agent’ın eski maddeleri birleştirmesi/silmesi bekleniyor.

Tam konuşmalar SQLite’ta tutuluyor ve FTS5 ile aranabiliyor: [Hermes persistent memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/).

Context dolduğunda session sıkıştırılıyor ve yeni continuation session açılıyor; lineage korunuyor: [Hermes sessions](https://hermes-agent.nousresearch.com/docs/user-guide/sessions/). Büyük dosya içerikleri sıkıştırma sırasında özetleniyor; tam metin korunmuş sayılmamalı: [context references](https://hermes-agent.nousresearch.com/docs/user-guide/features/context-references/).

Önemli ayrıntı: Hermes cron işleri de geçmiş konuşmayı sonsuza kadar sürdürmüyor. Her job fresh, izole session’da çalışıyor; gerekiyorsa önceki job çıktısı `context_from` ile aktarılıyor: [Hermes cron](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/).

### Uzun süre çalışınca ne bozuluyor?

**Context rot:** Context teknik limite ulaşmadan bile uzunluk ve distractor sayısı arttıkça performans düzensiz biçimde düşebiliyor. Chroma’nın 18 model üzerindeki 2025 çalışması bunu basit görevlerde de gözlemledi: [Context Rot](https://www.trychroma.com/research/context-rot).

**Özetleme kaybı:** İsimler, rakamlar, kaynakların hangi iddiayı desteklediği ve negatif bulgular özetlerde kaybolabilir. Recursive özetleme, eski bilgilerin etkisini giderek azaltır.

**Yanlış varsayımın kalıcılaşması:** 200 binden fazla simüle konuşmayı inceleyen çalışma, multi-turn görevlerde ortalama %39 performans düşüşü ve erken yanlış varsayımlardan kurtulamama gözlemledi: [LLMs Get Lost in Multi-Turn Conversation](https://arxiv.org/abs/2505.06120).

**Drift ve contamination:** Bir prospect hakkındaki stil, şirket veya persona bilgisi başka prospect’e sızabilir. Agent tarafından yazılan procedural memory/skill hatalı bir yöntemi standartlaştırabilir.

**Retrieval hataları:** Vector search semantik olarak benzer fakat yanlış/eski kaydı getirebilir; exact isim, sayı ve URL’lerde FTS/SQL daha güvenilirdir. Retrieval başarısızsa dışarıda duran bilgi agent açısından yok sayılır.

**Maliyet:** Uzayan geçmiş her turda yeniden gönderilirse input maliyeti büyür. Parallel araştırma faydalı olabilir ama Anthropic’in 2025 verilerinde normal agent yaklaşık 4×, multi-agent araştırma yaklaşık 15× chat tokenı kullanmış: [multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system).

**Güvenlik:** Web sayfasındaki prompt injection veya yanlış bilgi kalıcı belleğe/skill’e yazılırsa etkisi tek run’ı aşar. Outreach agent’ında internet içeriği “instruction” değil, yalnızca kanıt verisi olarak işaretlenmeli.

Bu yüzden “self-improving” ifadesi model ağırlıklarının otomatik iyileşmesi anlamına gelmez. Çoğunlukla agent’ın prompt, memory veya skill dosyası yazmasıdır; yararlı da olabilir, yanlış davranışı kurumsallaştırabilir de.

---

## 3. Persistent agent ile batch-cron karşılaştırması

| Boyut | Persistent yapı | Fresh batch/cron |
|---|---|---|
| Kampanya devamlılığı | Geri bildirim ve geçmiş kararları hatırlar | Açıkça state verilmezse her run sıfırdan başlar |
| Kişiselleştirme | Prospect geçmişini biriktirebilir | Dossier/input kalitesi kadar iyi |
| Tekrarlı araştırma | Cache ve geçmiş deneyimi kullanabilir | Aynı şirketi tekrar araştırabilir |
| İzolasyon | Prospect’ler arası sızıntı riski | Doğal olarak daha güçlü |
| Tekrarlanabilirlik | Bellek değiştikçe aynı input farklı sonuç verir | Prompt/model sabitlenirse daha deterministik |
| Hata kurtarma | Checkpoint ve resume avantajı | Job retry/idempotency daha basit |
| Audit | Çok sayıda örtük memory kararı oluşur | Input/output sınırı belirgindir |
| Context kalitesi | İyi kürasyon varsa zengin | Genellikle kısa ve temiz |
| Maliyet | Sürekli context ve reflection pahalılaşabilir | İş başına bütçe koymak kolay |
| Operasyon | Supervisor, memory curator ve migration gerekir | Cron/queue işletimi daha basit |

Araştırma doğal olarak paralelleştirilebilir; ancak e-posta yazımı prospect’e özgü ve hassas bir son aşamadır. En uygun ayrım:

`fresh araştırma worker’ları → doğrulanmış lead dossier → fresh yazar → evaluator → insan onayı/gönderim`

Persistent katman worker’ın konuşması değil; kampanya politikası, lead state’i, onaylanmış örnekler ve sonuç metrikleri olmalı.

---

## 4. Adapte edilebilecek 5 somut fikir

### 1. Her prospect için versiyonlu “lead dossier”

CRM/SQL kaydına ek olarak `lead_id/dossier.json` veya Markdown üretin:

- Doğrulanmış şirket/kişi gerçekleri
- Her gerçek için URL, erişim tarihi ve kısa alıntı/parafraz
- Varsayım ve confidence
- Daha önce kullanılan açılış açısı
- Contact/send durumu

Yazar agent yalnızca bu dossier’den kişiselleştirme yapsın; ham browser geçmişini görmesin.

### 2. Fresh run + persistent campaign memory

Cron ve tmux worker’larını koruyun. Her run fresh context ile başlasın fakat başlangıçta yalnızca:

- 1–2 sayfalık kampanya SOP’si
- Küçük tone/ICP profili
- İlgili lead dossier
- En fazla 2–3 onaylanmış iyi örnek

yüklensin. Tüm geçmiş konuşmayı yüklemeyin.

### 3. Ayrı “memory curator” batch’i

Günlük/haftalık job:

- Başarılı/başarısız e-postaları ve insan düzeltmelerini incelesin.
- Aday öğrenimleri önersin.
- Çelişki, eski tarih ve prospect’e özel bilgi sızıntısı arasın.
- Doğrudan production skill’i değiştirmesin; diff/PR üretsin.

Semantic bilgiye TTL ve `source/confidence/last_verified` alanları ekleyin.

### 4. Araştırmacı–yazar–hakem ayrımı

Aynı uzun session’ın hem araştırıp hem yazması confirmation bias yaratabilir.

- Researcher yalnızca kanıtlı dossier üretir.
- Writer dossier’den kısa e-posta taslağı üretir.
- Evaluator doğrulanmamış iddia, fazla genellik, ton, tekrar ve cross-lead leakage kontrolü yapar.
- Gönderim ayrı allow-listed servis ve insan onayı üzerinden geçer.

### 5. Context bütçesi ve ölçülebilir kalite kapıları

Her job için maksimum arama, tool-call, token ve süre bütçesi koyun. Şunları loglayın:

- Kaynaklı kişiselleştirme oranı
- Yanlış/eskimiş gerçek oranı
- İnsan tarafından değiştirilen cümle oranı
- Prospect başına token/maliyet
- Duplicate angle oranı
- Reply ve positive-reply oranı
- Bellekten gelen hangi kaydın kullanıldığı

A/B testini “persistent agent var/yok” yerine, aynı fresh worker üzerinde **dossier + küratörlü memory var/yok** olarak yapmak daha açıklayıcı olur.

## Nihai öneri

Hermes Agent’ı doğrudan mevcut sistemin yerine geçirmekten önce onun üç fikrini alın: küçük pinlenmiş bellek, aranabilir session arşivi ve checkpoint’li fresh jobs. En güvenli hedef mimari **kalıcı durum + geçici reasoning** yaklaşımıdır.

Hermes’i pilotlamak isterseniz tek bir kampanya ve yalnızca draft üretimiyle başlayın. Otomatik skill değişikliği ve otomatik gönderimi başlangıçta kapalı tutun. Hermes’in outreach kalitesini batch-cron’a karşı bağımsız ve güvenilir biçimde üstün gösteren, kamuya açık uzun dönem bir production değerlendirmesi bulamadım; kararın kendi dossier doğruluğu, maliyet ve insan-edit oranı ölçümlerinizle verilmesi gerekir.