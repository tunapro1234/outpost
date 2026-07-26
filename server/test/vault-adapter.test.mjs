import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createApp } from "../app.mjs";
import { WorkspaceRegistry } from "../lib/config.mjs";
import { VaultIndex, assertSafeVaultPath, setVaultReadOnly } from "../lib/vault.mjs";
import { TR_NETWORK_ADAPTER, resolveVaultAdapter } from "../lib/vault-adapters.mjs";
import {
  hasBlockedOutreachField,
  redactForOutreach,
} from "../lib/outreach-guard.mjs";
import { compileMailContext } from "../modules/mailer/writer.mjs";
import { temporaryDirectory, writeEntity } from "../test-support/helpers.mjs";

// A miniature copy of the business vault's shape: flat files, Turkish
// frontmatter, an "İlişkiler & …" heading variant and an "Açtığı kişiler" hub
// section. Nothing here touches the real vault.
async function writeTrVault(root) {
  const vault = path.join(root, "network");
  await fs.mkdir(vault, { recursive: true });
  const write = (name, source) => fs.writeFile(path.join(vault, `${name}.md`), source, "utf8");

  await write("Hasan Bilgin", `---
tip: kisi
kategori: yarisma-carki
probot-iliskisi: notr
bagli-kurum: Fikret Yüksel Vakfı
---

# Hasan Bilgin

## İlişkiler & Tuna'nın bağlantı yolu
- [[Fikret Yüksel Vakfı]] — yöneticisi.

## Açtığı kişiler (22 Tem görüşme)
[[Fatih Tüfekçi]] · [[Rüveyda]]
(ikinci halka: [[Rüveyda]]→[[Dilara Üstün]])
`);
  await write("Fatih Tüfekçi", `---
tip: kisi
kategori: lead-hasan-hoca
probot-iliskisi: lead
bagli-kurum: İBB Teknoloji Atölyeleri
sicaklik: sicak
durum: yazilacak
konum: İstanbul
etiketler: [ibb, atolye]
kimlik-guveni: iyi
---

# Fatih Tüfekçi

## İletişim
- 📞 0506 534 8499
- 🌐 teknolojiatolyeleri.ibb.istanbul

## İlişkiler
- [[Hasan Bilgin]] — açtı.
`);
  await write("Rüveyda", `---
tip: kisi
probot-iliskisi: lead
sicaklik: belirsiz
---

# Rüveyda

## İletişim
- 📞 Tuna'da
`);
  await write("Dilara Üstün", "---\ntip: kisi\n---\n\n# Dilara Üstün\n");
  await write("Fikret Yüksel Vakfı", "---\ntip: kurum\n---\n\n# Fikret Yüksel Vakfı\n");
  await write("İBB Teknoloji Atölyeleri", "---\ntip: kurum\n---\n\n# İBB Teknoloji Atölyeleri\n");
  await write("00-HARITA", "---\ntip: moc\n---\n\n# Harita\n\n[[Hasan Bilgin]]\n");
  await write("piyasa-haritasi", "# Frontmatter'sız not\n");
  // Invalid YAML on purpose: a quoted scalar with trailing prose.
  await write("Murat Kaya", `---
tip: kisi
bagli-kurum: "MBA okulu" (Boğaziçi bağı?)
sicaklik: ilik
---

# Murat Kaya

## İletişim
- 📞 0533 085 6979
`);
  return vault;
}

test("tr-network adapter düz TR vault'u Outpost modeline çevirir", async (t) => {
  const root = await temporaryDirectory("outpost-tr-vault-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const vault = await writeTrVault(root);

  const index = await new VaultIndex(vault, { adapter: TR_NETWORK_ADAPTER }).load();
  t.after(() => index.close());

  // MOC / frontmatter'sız notlar node değildir; kişi sayısına karışmazlar.
  const byType = {};
  for (const entity of index.entities.values()) {
    byType[entity.meta.type] = (byType[entity.meta.type] ?? 0) + 1;
  }
  assert.deepEqual(byType, { person: 5, institution: 2 });

  const fatih = index.entities.get("fatih-tufekci");
  assert.deepEqual(
    Object.fromEntries(
      ["type", "name", "role", "org", "closeness", "durum", "location", "lead_source"]
        .map((key) => [key, fatih.meta[key]]),
    ),
    {
      type: "person",
      name: "Fatih Tüfekçi",
      role: "lead",
      org: "İBB Teknoloji Atölyeleri",
      closeness: 3,
      durum: "yazilacak",
      location: "İstanbul",
      lead_source: "hasan-hoca",
    },
  );
  assert.deepEqual(fatih.meta.tags, ["ibb", "atolye"]);
  // Kaynak TR frontmatter aynen korunur — vault'a hiç dokunulmadan.
  assert.equal(fatih.meta.source_meta["probot-iliskisi"], "lead");
});

test("sicaklik yokluğu closeness=0 DEĞİL null'dır", async (t) => {
  const root = await temporaryDirectory("outpost-tr-closeness-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const vault = await writeTrVault(root);
  const index = await new VaultIndex(vault, { adapter: TR_NETWORK_ADAPTER }).load();
  t.after(() => index.close());

  // "belirsiz" bir okumadır -> 0. Alanın hiç olmaması veri yokluğudur -> null.
  assert.equal(index.entities.get("ruveyda").meta.closeness, 0);
  assert.equal(index.entities.get("hasan-bilgin").meta.closeness ?? null, null);
  assert.equal(index.entities.get("dilara-ustun").meta.closeness ?? null, null);
  assert.equal(index.entities.get("fatih-tufekci").meta.closeness, 3);
  assert.equal(index.entities.get("murat-kaya").meta.closeness, 2);
});

test("Açtığı kişiler bölümü yönlü 'açtı' kenarı üretir, ikinci halkayı hub'a yazmaz", async (t) => {
  const root = await temporaryDirectory("outpost-tr-edges-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const vault = await writeTrVault(root);
  const index = await new VaultIndex(vault, { adapter: TR_NETWORK_ADAPTER }).load();
  t.after(() => index.close());

  const opened = index.edges
    .filter((edge) => edge.source === "hasan-bilgin" && edge.label === "açtı")
    .map((edge) => edge.target)
    .sort();
  assert.deepEqual(opened, ["fatih-tufekci", "ruveyda"]);
  // "(ikinci halka: …)" satırı hub'ın açtığı kişi değildir.
  assert.ok(!opened.includes("dilara-ustun"));
  // "## İlişkiler & …" başlık varyantı da ilişki olarak okunur.
  assert.ok(index.edges.some((edge) =>
    edge.source === "hasan-bilgin" && edge.target === "fikret-yuksel-vakfi"
    && edge.kind === "relation"));
});

test("bozuk YAML frontmatter'lı not düşürülmez, uyarıyla satır satır okunur", async (t) => {
  const root = await temporaryDirectory("outpost-tr-lenient-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const vault = await writeTrVault(root);
  const index = await new VaultIndex(vault, { adapter: TR_NETWORK_ADAPTER }).load();
  t.after(() => index.close());

  const murat = index.entities.get("murat-kaya");
  assert.equal(murat.meta.name, "Murat Kaya");
  assert.equal(murat.meta.org, '"MBA okulu" (Boğaziçi bağı?)');
  assert.equal(index.warnings.length, 1);
  assert.match(index.warnings[0], /Murat Kaya\.md: frontmatter YAML olarak okunamadı/);
});

test("İletişim bölümünden telefon okunur; numara olmayan not telefon sayılmaz", async (t) => {
  const root = await temporaryDirectory("outpost-tr-phone-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const vault = await writeTrVault(root);
  const index = await new VaultIndex(vault, { adapter: TR_NETWORK_ADAPTER }).load();
  t.after(() => index.close());

  const fatih = index.entities.get("fatih-tufekci");
  assert.equal(fatih.meta.phone, "0506 534 8499");
  assert.equal(fatih.meta.phone_source, "elden");
  assert.equal(fatih.meta.contact_channel, "telefon");
  assert.equal(fatih.meta.kimlik_guveni, "iyi");
  // "📞 Tuna'da" = numarayı biri tutuyor, numara değil.
  assert.equal(index.entities.get("ruveyda").meta.phone ?? null, null);
});

// ---------------------------------------------------------------------------
// phone MUST NOT reach outreach
// ---------------------------------------------------------------------------

test("redactForOutreach elle toplanan iletişim alanlarını mail akışından siler", () => {
  const meta = {
    type: "person",
    name: "Fatih Tüfekçi",
    mail: "fatih@example.com",
    phone: "0506 534 8499",
    phone_source: "elden",
    contact_channel: "telefon",
    kimlik_guveni: "iyi",
    whatsapp: "+90506",
    source_meta: { telefon: "0506 534 8499", "kimlik-guveni": "iyi", tip: "kisi" },
  };
  const safe = redactForOutreach(meta);
  assert.deepEqual(safe, {
    type: "person",
    name: "Fatih Tüfekçi",
    mail: "fatih@example.com",
    source_meta: { tip: "kisi" },
  });
  assert.equal(hasBlockedOutreachField(safe), false);
  // Kaynak nesne değiştirilmez; ekran tarafı telefonu görmeye devam eder.
  assert.equal(meta.phone, "0506 534 8499");
});

test("mail yazarı bağlam paketi telefonu ASLA görmez", async () => {
  const prompts = [];
  const person = {
    id: "fatih-tufekci",
    meta: {
      type: "person",
      name: "Fatih Tüfekçi",
      mail: "fatih@example.com",
      phone: "0506 534 8499",
      phone_source: "elden",
      kimlik_guveni: "iyi",
      source_meta: { telefon: "0506 534 8499" },
    },
  };
  await compileMailContext(
    {
      person,
      company: { meta: { type: "institution", name: "İBB", phone: "0212 000 0000" } },
      queueItem: { score: 50, reasons: [] },
      agent: { model: "test" },
      workspace: null,
      user: null,
    },
    {
      runLuna: async (prompt) => {
        prompts.push(prompt);
        return "bağlam";
      },
      skillsPath: path.join(process.cwd(), "does-not-exist"),
    },
  );
  assert.equal(prompts.length, 1);
  assert.ok(!prompts[0].includes("0506 534 8499"), "telefon prompt'a sızdı");
  assert.ok(!prompts[0].includes("0212 000 0000"), "kurum telefonu prompt'a sızdı");
  assert.ok(!prompts[0].includes("kimlik_guveni"), "kimlik güveni prompt'a sızdı");
  assert.ok(prompts[0].includes("fatih@example.com"), "mail adresi bağlamda kalmalı");
});

// ---------------------------------------------------------------------------
// mounting an in-place, foreign vault
// ---------------------------------------------------------------------------

test("read_only workspace'in vault'una her yazma yolu 403 ile reddedilir", async (t) => {
  const root = await temporaryDirectory("outpost-readonly-ws-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const external = await temporaryDirectory("outpost-readonly-vault-");
  t.after(() => fs.rm(external, { recursive: true, force: true }));
  t.after(() => setVaultReadOnly(external, false));
  await fs.writeFile(
    path.join(external, "Kişi.md"),
    "---\ntip: kisi\n---\n\n# Kişi\n",
    "utf8",
  );
  await fs.mkdir(path.join(root, "business"), { recursive: true });
  await fs.writeFile(
    path.join(root, "business", "config.yaml"),
    `name: Business\ncode: biz\nvault_path: ${external}\nadapter: tr-network\nread_only: true\n`,
    "utf8",
  );

  const registry = await WorkspaceRegistry.load({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
  });
  t.after(() => registry.close());
  const workspace = registry.get("business");

  assert.equal(workspace.vaultPath, path.resolve(external));
  assert.equal(workspace.adapter.name, "tr-network");
  assert.equal(workspace.readOnly, true);
  assert.equal(workspace.index.entities.size, 1);

  // Okuma serbest, yazma niyeti reddedilir.
  await assertSafeVaultPath(external, path.join(external, "Kişi.md"), { intent: "read" });
  await assert.rejects(
    () => assertSafeVaultPath(external, path.join(external, "Kişi.md")),
    (error) => error.statusCode === 403,
  );
  // Dosya diskte aynen kalır.
  assert.equal(
    await fs.readFile(path.join(external, "Kişi.md"), "utf8"),
    "---\ntip: kisi\n---\n\n# Kişi\n",
  );
});

test("iki workspace bağımsız kalır — otomatik merge/dedup yapılmaz", async (t) => {
  // İsim benzerliği kimlik kanıtı değildir. Business vault'undaki "Fırat"
  // SOYADSIZ kayıtlı ve Outpost'taki firat-ozcan.md ile aynı kişi olduğu
  // TEYİTSİZ; aynısı ruveyda-kafa.md için geçerli. Ayrıca vault'ta aynı adı
  // taşıyan farklı insanlar bulunabiliyor (hasan-bilgin / hasan-aydin gibi ayrı
  // node'lar). Eşleştirme yalnız insan teyidiyle yapılır.
  const root = await temporaryDirectory("outpost-no-merge-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const external = await temporaryDirectory("outpost-no-merge-vault-");
  t.after(() => fs.rm(external, { recursive: true, force: true }));
  t.after(() => setVaultReadOnly(external, false));
  await fs.writeFile(path.join(external, "Fırat.md"), "---\ntip: kisi\n---\n\n# Fırat\n", "utf8");

  await fs.mkdir(path.join(root, "probot"), { recursive: true });
  await fs.writeFile(path.join(root, "probot", "config.yaml"), "name: Probot\n", "utf8");
  await writeEntity(
    path.join(root, "probot", "vault"),
    "people",
    "firat-ozcan",
    "---\ntype: person\nname: Fırat Özcan\n---\n",
  );
  await fs.mkdir(path.join(root, "business"), { recursive: true });
  await fs.writeFile(
    path.join(root, "business", "config.yaml"),
    `name: Business\nvault_path: ${external}\nadapter: tr-network\nread_only: true\n`,
    "utf8",
  );
  await fs.writeFile(path.join(root, "config.yaml"), "default_workspace: probot\n", "utf8");

  const app = await createApp({ workspacesPath: root, outpostVault: null, watch: false });
  t.after(() => app.close());

  const probot = (await app.inject({ url: "/api/ws/probot/entities" })).json();
  const business = (await app.inject({ url: "/api/ws/business/entities" })).json();
  assert.deepEqual(probot.map((entity) => entity.id), ["firat-ozcan"]);
  assert.deepEqual(business.map((entity) => entity.id), ["firat"]);
  // Hiçbir kenar/kayıt workspace sınırını geçmez.
  assert.equal(app.workspaceRegistry.get("probot").index.entities.has("firat"), false);
  assert.equal(app.workspaceRegistry.get("business").index.entities.has("firat-ozcan"), false);
  assert.equal(app.workspaceRegistry.getDefault().id, "probot");
});

test("read_only workspace'te entity yazma uçları 403 döner", async (t) => {
  const root = await temporaryDirectory("outpost-readonly-routes-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const external = await temporaryDirectory("outpost-readonly-routes-vault-");
  t.after(() => fs.rm(external, { recursive: true, force: true }));
  t.after(() => setVaultReadOnly(external, false));
  const source = "---\ntip: kisi\n---\n\n# Kişi\n";
  await fs.writeFile(path.join(external, "Kişi.md"), source, "utf8");
  await fs.mkdir(path.join(root, "business"), { recursive: true });
  await fs.writeFile(
    path.join(root, "business", "config.yaml"),
    `name: Business\nvault_path: ${external}\nadapter: tr-network\nread_only: true\n`,
    "utf8",
  );

  const app = await createApp({ workspacesPath: root, outpostVault: null, watch: false });
  t.after(() => app.close());

  const base = "/api/ws/business/entities";
  const calls = [
    { method: "PATCH", url: `${base}/kisi`, payload: { meta: { role: "test" } } },
    { method: "POST", url: base, payload: { type: "person", name: "Sızma Testi" } },
    { method: "DELETE", url: `${base}/kisi` },
  ];
  for (const call of calls) {
    const response = await app.inject(call);
    assert.equal(response.statusCode, 403, `${call.method} ${call.url}`);
  }
  // Vault diskte bit bit aynı: yeni dosya da yok, .trash de yok.
  assert.deepEqual(await fs.readdir(external), ["Kişi.md"]);
  assert.equal(await fs.readFile(path.join(external, "Kişi.md"), "utf8"), source);
});

test("bilinmeyen adapter adı açıkça hata verir, sessizce default'a düşmez", () => {
  assert.equal(resolveVaultAdapter(undefined).name, "default");
  assert.equal(resolveVaultAdapter("default").name, "default");
  assert.throws(() => resolveVaultAdapter("yok-boyle-bir-sey"), /bilinmeyen vault adapter/);
});
