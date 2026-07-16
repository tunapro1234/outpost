# Outpost Filter SPEC (V3a) — tek sorgu, iki görünüm, üç etki

Kaynak: `research/filtre-ux.md` (Linear/Notion/Airtable/Neo4j Bloom/Kumu/Obsidian taraması,
2026-07-16). Karar cümlesi: **tek `queryState`, Graph+List aynı sorguyu okur; sonuç üç etkiden
biriyle uygulanır: Filter (çıkar) / Highlight (soldur) / Focus (N-adım komşuluk).**
Selector dili, Cypher, centrality jargonu varsayılan UI'a ÇIKMAZ. UI dili İngilizce.

## 1. Canonical state (core'da yaşar, URL'e encode edilir)
```ts
{
  where: FilterGroup,        // AND/OR AST, max 2 seviye nesting
  effect: "filter" | "highlight",
  focus: { roots: string[], depth: 1|2|3, edgeKinds: ("relation"|"mention")[] } | null,
  graph: { reduceHubs: boolean, hideIsolated: boolean, showMentions: boolean },
  sort: ..., columns: ...    // sadece List'i etkiler
}
```
Alanlar (facet'lerden): type, subtype, status, score, degree, city, district, mail (has/none),
mail_source, closeness, mail_count, last_mail_date, last_mail_direction, tags, free-text.
Operatörler alan tipine göre: is / is not / any of / at least / at most / older than / newer than /
contains / is empty.

## 2. Dört katman (progressive disclosure)
- **A. Şerit (her zaman görünür, header altı):** arama kutusu (entity + doğal dil birlikte;
  öneriler tür etiketli) · aktif filtre chip'leri (x ile kalkar) · `+ Filter` · sonuç sayacı
  ("214 people · 37 companies · 612 links") · Save / Clear all · ortada Graph|List toggle.
- **B. Gelişmiş panel (`+ Filter` → popover; "Advanced" → sağ panel):** satır bazlı kural
  builder (alan ara → operatör → değer), `+ Condition` / `+ OR group` (max 2 seviye), canlı
  preview (250-400ms debounce), altta Graph davranışı: effect radyosu (Filter/Highlight) +
  Reduce hubs + Hide isolated toggles.
- **C. Node bağlam menüsü (sağ tık / panel butonları):** Focus: 1 step · Find similar
  (filter-by-example: aynı subtype+şehir+skor bandı → düzenlenebilir kural olarak açılır) ·
  Filter to selection · Exclude · (2 node seçiliyken: Find path between · Show only selected).
- **D. Saved views:** ad + queryState; Update / Save as / Copy link; "unsaved changes" rozeti.
  Başlangıç preset'leri:
  1. **First touch** — person/company + mail var + hiç outbound yok
  2. **Follow-up due** — outbound var + ≥14 gün + reply yok
  3. **Replied** — inbound reply var, son reply yeni→eski
  4. **Bridge people** — person + degree üst dilim, effect=highlight
  5. **Clean network** — hideIsolated + reduceHubs, koşulsuz
  6. **Targets** — company/institution/school + score ≥ 15

## 3. Doğal dil kısayolu (V3c, copilot'la)
Arama kutusuna serbest cümle ("istanbul'daki mailsiz atölyeler", "who replied last week") →
copilot endpoint'i queryState AST döndürür → chip'lere çevrilir (kullanıcı düzenleyebilir).
LLM çıktısı ASLA doğrudan çalışmaz; her zaman görünür chip/kurala dönüşür.

## 4. Uygulama notları
- Graph highlight modu: eşleşmeyen node/kenar alpha ~0.12; eşleşen tam. Focus modu üst bilgi
  şeridi gösterir: "Focused on X · 2 steps · Exit".
- List aynı where/focus'u kullanır; kamera ve kolon state'i görünüme özel kalır.
- Sayaçlar her facet değerinin YANINDA (Bloom/Linear kalıbı), sıfırlılar soluk.
- Performans: filtre değişiminde yalnız alt-küme force'a girer; debounce; queryState
  hesaplaması pure fonksiyon (test edilir).
- `mail_count/last_mail_*` alanları server'ın entities çıktısından gelir (SPEC-V3 §3).
