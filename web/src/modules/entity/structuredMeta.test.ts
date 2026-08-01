import test from "node:test";
import assert from "node:assert/strict";
import {
  competitionHistory,
  normalizeAuditIssues,
  normalizeConfidence,
  normalizeContacts,
  normalizeDrafts,
  normalizeEvidence,
  normalizeNotFound,
  normalizeProfileNote,
  normalizeProducts,
  normalizeSources,
  normalizeStringList,
  normalizeWarnings,
  wikilinkTarget,
} from "./structuredMeta.ts";

test("profil bilgi notlarını yalnızca dolu metin olarak normalize eder", () => {
  assert.equal(normalizeProfileNote("  Kulvar bilgisi  "), "Kulvar bilgisi");
  assert.equal(normalizeProfileNote("   "), null);
  assert.equal(normalizeProfileNote(["metin değil"]), null);
});

test("structured entity meta ürün, ödül, sezon ve takım alanlarını normalize eder", () => {
  assert.deepEqual(normalizeProducts([
    {
      name: "FTC Başlangıç Kiti",
      price: 1250,
      currency: "TRY",
      url: "https://example.test/kit",
      note: "Stokta",
      top_seller: true,
    },
    { price: 10 },
  ]), [{
    name: "FTC Başlangıç Kiti",
    price: 1250,
    currency: "TRY",
    url: "https://example.test/kit",
    note: "Stokta",
    top_seller: true,
  }]);
  assert.deepEqual(normalizeStringList(["Finalist", ["Tasarım Ödülü"]]), [
    "Finalist",
    "Tasarım Ödülü",
  ]);
  assert.equal(wikilinkTarget("[[Anka Robotics|Anka]]"), "Anka Robotics");
  assert.equal(
    competitionHistory(
      { competing_since: 2021, seasons: [2024, "2022", 2024] },
      2026
    ),
    "2021'den beri (5 yıl) · Sezonlar: 2022, 2024"
  );
});

test("bu turda çıkmayanları nesne ve eski string biçiminden normalize eder", () => {
  assert.deepEqual(normalizeNotFound([
    { madde: "Mentor adı", tur: "bulunamadi" },
    { madde: "Kişisel telefon", tur: "aranmadi" },
    { madde: "Site taraması", tur: "bakilamadi" },
    { madde: "Etiketsiz kayıt" },
    "Eski düz string",
    { madde: "Bilinmeyen tur", tur: "gecersiz" },
    { tur: "bulunamadi" },
  ]), [
    { text: "Mentor adı", type: "bulunamadi" },
    { text: "Kişisel telefon", type: "aranmadi" },
    { text: "Site taraması", type: "bakilamadi" },
    { text: "Etiketsiz kayıt", type: null },
    { text: "Eski düz string", type: null },
    { text: "Bilinmeyen tur", type: null },
  ]);
});

test("hedef profil alanlarını güvenli ve kaynak zorunlu biçimde normalize eder", () => {
  assert.deepEqual(normalizeConfidence({ sinif: "kesin", ham: "kesin (resmî site)" }), {
    level: "kesin",
    raw: "kesin (resmî site)",
  });
  assert.deepEqual(normalizeContacts({
    tel: { deger: "+90 212", kaynak: "Resmî site" },
    mail: { deger: "tahmin@example.test", kaynak: "Kalıp", tahmin: true },
    linkedin: { deger: "https://linkedin.test/x" },
  }), [
    { channel: "tel", value: "+90 212", source: "Resmî site", estimated: false },
    { channel: "mail", value: "tahmin@example.test", source: "Kalıp", estimated: true },
  ]);
  assert.deepEqual(normalizeEvidence([{ ne: "FTC alımı", tarih: "2026", kaynak: "Fatura" }]), [
    { text: "FTC alımı", date: "2026", source: "Fatura" },
  ]);
  assert.equal(normalizeDrafts([{ kanal: "mail", metin: "Merhaba", duzeltilmis: true }])[0].corrected, true);
  assert.equal(normalizeAuditIssues([{ tip: "dogrulama", aciklama: "TEMİZ — sorun yok" }])[0].clean, true);
});

test("katman-1 uyarılarını ve kaynaklarını anlam eklemeden normalize eder", () => {
  const longWarning = "⚠️ EŞİT-MESAFE ETİKETİ. Temas serbest, ancak ürün detayı paylaşılmaz; madde ortasından kesilmez.";
  assert.deepEqual(normalizeWarnings([
    "🔴 Kırmızı uyarı",
    longWarning,
    "📌 Nötr not",
    "⛔ Temas yok",
  ]), [
    { text: "🔴 Kırmızı uyarı", tone: "danger" },
    { text: longWarning, tone: "warning" },
    { text: "📌 Nötr not", tone: "neutral" },
    { text: "⛔ Temas yok", tone: "danger" },
  ]);

  assert.deepEqual(normalizeSources([
    { metin: "resmî sayfa", tur: "acik", url: "https://example.test", iddia: "Takım mentoru" },
    { metin: "CRM kaydı", tur: "ic", iddia: "Telefon teyidi" },
    { metin: "türü belirtilmemiş kaynak", url: "https://example.test/unknown" },
  ]), [
    { text: "resmî sayfa", type: "acik", url: "https://example.test", claim: "Takım mentoru" },
    { text: "CRM kaydı", type: "ic", url: null, claim: "Telefon teyidi" },
    { text: "türü belirtilmemiş kaynak", type: null, url: "https://example.test/unknown", claim: null },
  ]);
});
