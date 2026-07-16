import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { importVault } from "../importer.mjs";
import { VaultIndex } from "../lib/vault.mjs";
import { temporaryDirectory, writeEntity } from "../test-support/helpers.mjs";

test("importer mini fixture alanlarını ve kurum kategorilerini eşler", async (t) => {
  const root = await temporaryDirectory("outpost-importer-");
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await writeEntity(
    source,
    "kisiler",
    "Şule Işık",
    `---
tip: kisi
rol: egitmen
yakinlik: 4
mezuniyet-okul: Örnek Üniversitesi
mezuniyet-yil: "2020"
mezuniyet-bolum: Tasarım
mezuniyet-bolum: Son Tasarım
mail-kaynak: yayimlanmis
sehir: İzmir
ozel-kaynak: fixture
---
# Şule Işık

Tanım değişmemeli.

## İlişkiler
- [[Mavi Kolej]] — çalışıyor
`,
  );
  await writeEntity(
    source,
    "kurumlar",
    "Mavi Kolej",
    `---
tip: kurum
kategori: kolej
durum: aday
skor: 17
tel: "000"
---
# Mavi Kolej

Kolej body.
`,
  );
  await writeEntity(
    source,
    "kurumlar",
    "Belirsiz Kurum",
    `---
tip: kurum
kategori: baska
---
# Belirsiz Kurum

Belirsiz body.
`,
  );
  await writeEntity(source, "kisiler", "00-Liste", "---\ntip: kisi\n---\n# Liste\n");

  const report = await importVault(source, target);
  assert.equal(report.imported, 3);
  assert.deepEqual(report.byType, { person: 1, school: 1, company: 1 });
  assert.equal(report.categoryDistribution.kolej, 1);
  assert.equal(report.skipped.length, 1);
  assert.equal(report.warnings.length, 2);
  assert.ok(report.warnings.some((warning) => warning.includes("yinelenen YAML")));

  const personPath = path.join(target, "people", "sule-isik.md");
  const person = matter(await fs.readFile(personPath, "utf8"));
  assert.equal(person.data.type, "person");
  assert.equal(person.data.name, "Şule Işık");
  assert.equal(person.data.role, "egitmen");
  assert.equal(person.data.closeness, 4);
  assert.equal(person.data.alumni_school, "Örnek Üniversitesi");
  assert.equal(person.data.alumni_dept, "Son Tasarım");
  assert.equal(person.data.mail_source, "yayimlanmis");
  assert.equal(person.data.city, "İzmir");
  assert.equal(person.data["ozel-kaynak"], "fixture");
  assert.equal(Object.hasOwn(person.data, "tip"), false);
  assert.match(person.content, /\[\[Mavi Kolej\]\] — çalışıyor/);

  const school = matter(
    await fs.readFile(path.join(target, "schools", "mavi-kolej.md"), "utf8"),
  );
  assert.equal(school.data.type, "school");
  assert.equal(school.data.subtype, "kolej");
  assert.equal(school.data.status, "aday");
  assert.equal(school.data.score, 17);
  assert.equal(school.data.phone, "000");

  const index = await new VaultIndex(target).load();
  assert.deepEqual(index.edges, [{
    source: "sule-isik",
    target: "mavi-kolej",
    label: "çalışıyor",
    kind: "relation",
  }]);
});
