// Turkish-aware normalization for fuzzy search.
const MAP: Record<string, string> = {
  ş: "s",
  Ş: "s",
  ğ: "g",
  Ğ: "g",
  ı: "i",
  I: "i",
  İ: "i",
  ö: "o",
  Ö: "o",
  ü: "u",
  Ü: "u",
  ç: "c",
  Ç: "c",
  â: "a",
  î: "i",
  û: "u",
};

export function trNormalize(s: string): string {
  let out = "";
  for (const ch of s.toLowerCase()) {
    out += MAP[ch] ?? ch;
  }
  return out
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

export function matchScore(query: string, target: string): number {
  const q = trNormalize(query);
  const t = trNormalize(target);
  if (!q) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 - t.length;
  const idx = t.indexOf(q);
  if (idx >= 0) return 500 - idx - t.length;
  // subsequence fallback
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  if (qi === q.length) return 100 - t.length;
  return -1;
}
