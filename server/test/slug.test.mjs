import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSearch, slugify } from "../lib/slug.mjs";

test("slugify Türkçe karakterleri ve boşlukları SPEC'e göre dönüştürür", () => {
  assert.equal(slugify("  Şağlık İçin Özgür Üç Çocuk  "), "saglik-icin-ozgur-uc-cocuk");
  assert.equal(slugify("Boğaziçi Üniversitesi"), "bogazici-universitesi");
  assert.equal(slugify("F² / Robot!"), "f2-robot");
});

test("arama normalizasyonu case ve Türkçe aksanlardan bağımsızdır", () => {
  assert.equal(normalizeSearch(" KIVILCIM  Atölyesi "), "kivilcim atolyesi");
});
