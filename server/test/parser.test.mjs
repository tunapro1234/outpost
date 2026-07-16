import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { VaultIndex, extractLinks, parseMarkdown } from "../lib/vault.mjs";
import { temporaryDirectory, writeEntity } from "../test-support/helpers.mjs";

test("frontmatter, relation, mention ve unresolved wikilinkleri çıkarır", async (t) => {
  const vault = await temporaryDirectory();
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  await writeEntity(
    vault,
    "people",
    "ornek-kisi",
    `---
type: person
name: Örnek Kişi
bilinmeyen_alan: korunur
---
İlk paragraf [[Başka Kurum]] kaydını anıyor.

## İlişkiler
- [[Başka Kurum|Kurum]] — çalışıyor
- [[Olmayan Hedef]] — tanıyor

## Notlar
[[Başka Kurum]] tekrar anıldı.
`,
  );
  await writeEntity(
    vault,
    "institutions",
    "baska-kurum",
    `---
type: institution
name: Başka Kurum
---
Hayalî kurum. [[Örnek Kişi]] kaydını anıyor.
`,
  );

  const index = await new VaultIndex(vault).load();
  const detail = index.entityDetail("ornek-kisi");
  assert.equal(detail.meta.bilinmeyen_alan, "korunur");
  assert.deepEqual(detail.unresolved, ["Olmayan Hedef"]);
  assert.deepEqual(
    index.edges.filter((edge) => edge.source === "ornek-kisi"),
    [
      {
        source: "ornek-kisi",
        target: "baska-kurum",
        label: "çalışıyor",
        kind: "relation",
      },
    ],
    "aynı entity çifti arasında relation varken iki yöndeki mention'lar bastırılmalı",
  );
});

test("parser markdown body ve frontmatter'ı ayırır", () => {
  const parsed = parseMarkdown(
    `---
type: company
name: Çizgi AŞ
score: 12.5
found_date: 2026-07-01
---
Tanım.

## İlişkiler
- [[Bir Okul]] — sponsor
`,
    "/tmp/cizgi-as.md",
  );
  assert.equal(parsed.id, "cizgi-as");
  assert.equal(parsed.meta.score, 12.5);
  assert.equal(parsed.meta.found_date, "2026-07-01");
  assert.match(parsed.body, /^Tanım\./);
  assert.deepEqual(parsed.links.relations, [{ target: "Bir Okul", label: "sponsor" }]);
});

test("alt başlıklı İlişkiler bölümü gerçek vault varyasyonunu da okur", () => {
  const links = extractLinks(`## Takım
### İlişkiler
- [[FRC Takımı]] — mentor

### Kaynaklar
- [[Kaynak Notu]]
`);
  assert.deepEqual(links.relations, [{ target: "FRC Takımı", label: "mentor" }]);
  assert.deepEqual(links.mentions, [{ target: "Kaynak Notu", label: null }]);
});
