import type { EntityMeta, EntityProduct } from "../../core/types";

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function flattenText(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(flattenText);
  const item = text(value);
  return item ? [item] : [];
}

export function normalizeProducts(value: unknown): EntityProduct[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    const name = text(raw.name);
    if (!name) return [];
    const price =
      typeof raw.price === "number" && Number.isFinite(raw.price)
        ? raw.price
        : text(raw.price);
    return [{
      name,
      price,
      currency: text(raw.currency),
      url: text(raw.url),
      note: text(raw.note),
      top_seller: raw.top_seller === true,
    }];
  });
}

export function normalizeStringList(value: unknown): string[] {
  return [...new Set(flattenText(value))];
}

export function wikilinkTarget(value: string): string {
  const match = value.match(/^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
  return (match?.[1] ?? value).trim();
}

function year(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed >= 1900 && parsed <= 2200
    ? parsed
    : null;
}

export function competitionHistory(
  meta: Pick<EntityMeta, "competing_since" | "seasons">,
  currentYear = new Date().getFullYear()
): string | null {
  const since = year(meta.competing_since);
  const seasons = normalizeStringList(meta.seasons)
    .map(year)
    .filter((item): item is number => item !== null)
    .sort((left, right) => left - right);
  const uniqueSeasons = [...new Set(seasons)];
  const parts: string[] = [];
  if (since !== null) {
    const elapsed = Math.max(0, currentYear - since);
    parts.push(`${since}'den beri (${elapsed} yıl)`);
  }
  if (uniqueSeasons.length) {
    parts.push(`Sezonlar: ${uniqueSeasons.join(", ")}`);
  }
  return parts.join(" · ") || null;
}
