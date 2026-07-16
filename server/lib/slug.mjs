const TURKISH_ASCII = new Map([
  ["ı", "i"],
  ["İ", "I"],
  ["ş", "s"],
  ["Ş", "S"],
  ["ğ", "g"],
  ["Ğ", "G"],
  ["ö", "o"],
  ["Ö", "O"],
  ["ü", "u"],
  ["Ü", "U"],
  ["ç", "c"],
  ["Ç", "C"],
]);

export function toAscii(value) {
  return String(value ?? "")
    .replace(/[ıİşŞğĞöÖüÜçÇ]/g, (character) => TURKISH_ASCII.get(character))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeSearch(value) {
  return toAscii(value).toLowerCase().replace(/\s+/g, " ").trim();
}

export function slugify(value) {
  return normalizeSearch(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
