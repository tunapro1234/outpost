import test from "node:test";
import assert from "node:assert/strict";
import {
  competitionHistory,
  normalizeProducts,
  normalizeStringList,
  wikilinkTarget,
} from "./structuredMeta.ts";

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
