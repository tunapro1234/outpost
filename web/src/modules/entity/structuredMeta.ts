import type { EntityMeta, EntityProduct } from "../../core/types";

export interface ProfileConfidence {
  level: "kesin" | "muhtemel" | "tahmin" | "belirsiz";
  raw: string;
}

export interface ProfileContact {
  channel: "tel" | "mail" | "linkedin" | "instagram";
  value: string;
  source: string;
  estimated: boolean;
}

export interface ProfileEvidence {
  text: string;
  date: string | null;
  source: string | null;
}

export interface ProfileDraft {
  channel: string;
  person: string | null;
  subject: string | null;
  text: string;
  corrected: boolean;
}

export interface ProfileAuditIssue {
  type: string;
  person: string | null;
  description: string;
  clean: boolean;
}

export interface ProfileWarning {
  text: string;
  tone: "danger" | "warning" | "neutral";
}

export interface ProfileSource {
  text: string;
  type: "acik" | "ic" | null;
  url: string | null;
  claim: string | null;
}

export interface ProfileNotFoundItem {
  text: string;
  type: "bulunamadi" | "bakilamadi" | "aranmadi" | null;
}

export const SCHOOL_STRUCTURE_FIELDS = [
  ["yapi", "Yapı"],
  ["kampus", "Kampüs"],
  ["karar_merkezi", "Karar merkezi"],
  ["takvim", "Takvim"],
  ["pencere", "Pencere"],
  ["robotik_izi", "Robotik izi"],
  ["kendi_kiti", "Kendi kiti"],
  ["ucret", "Ücret"],
] as const;

export type SchoolStructureKey = typeof SCHOOL_STRUCTURE_FIELDS[number][0];

export interface SchoolStructureRow {
  key: SchoolStructureKey;
  label: string;
  value: string;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function confidenceLevel(value: string): ProfileConfidence["level"] {
  const normalized = value
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ı", "i");
  if (normalized.startsWith("kesin")) return "kesin";
  if (normalized.startsWith("muhtemel")) return "muhtemel";
  if (normalized.startsWith("tahmin")) return "tahmin";
  // Bileşik/serbest metin hiçbir sınıfa zorlanmaz; nötr görünür. Özellikle "tahmin"e
  // düşürülmez — sahte tahmin rozeti kesin kimliği kullanılmaz gösterir.
  return "belirsiz";
}

export function normalizeConfidence(value: unknown): ProfileConfidence | null {
  const object = record(value);
  const raw = text(object?.ham) ?? text(value);
  const declared = text(object?.sinif);
  if (!raw && !declared) return null;
  const display = raw ?? declared!;
  return { level: confidenceLevel(declared ?? display), raw: display };
}

export function normalizeContacts(value: unknown): ProfileContact[] {
  const contact = record(value);
  if (!contact) return [];
  return (["tel", "mail", "linkedin", "instagram"] as const).flatMap((channel) => {
    const item = record(contact[channel]);
    const contactValue = text(item?.deger);
    const source = text(item?.kaynak);
    if (!contactValue || !source) return [];
    return [{
      channel,
      value: contactValue,
      source,
      estimated: channel === "mail" && item?.tahmin === true,
    }];
  });
}

export function normalizeEvidence(value: unknown): ProfileEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const raw = record(item);
    const evidenceText = text(raw?.ne) ?? text(item);
    if (!evidenceText) return [];
    return [{
      text: evidenceText,
      date: text(raw?.tarih),
      source: text(raw?.kaynak),
    }];
  });
}

export function normalizeDrafts(value: unknown): ProfileDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const raw = record(item);
    const channel = text(raw?.kanal);
    const draftText = text(raw?.metin);
    if (!channel || !draftText) return [];
    return [{
      channel,
      person: text(raw?.kisi),
      subject: text(raw?.konu),
      text: draftText,
      corrected: raw?.duzeltilmis === true,
    }];
  });
}

export function normalizeAuditIssues(value: unknown): ProfileAuditIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const raw = record(item);
    const issueType = text(raw?.tip);
    const description = text(raw?.aciklama);
    if (!issueType || !description) return [];
    const normalizedType = issueType.toLocaleLowerCase("tr");
    return [{
      type: issueType,
      person: text(raw?.kisi),
      description,
      clean: normalizedType === "dogrulama" && /^TEMİZ\b/u.test(description),
    }];
  });
}

export function normalizeWarnings(value: unknown): ProfileWarning[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const warningText = text(item);
    if (!warningText) return [];
    const tone = /^(?:🔴|⛔)/u.test(warningText)
      ? "danger"
      : /^⚠️/u.test(warningText)
        ? "warning"
        : "neutral";
    return [{ text: warningText, tone }];
  });
}

export function normalizeSources(value: unknown): ProfileSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const raw = record(item);
    const sourceText = text(raw?.metin) ?? text(item);
    if (!sourceText) return [];
    const rawType = text(raw?.tur);
    const sourceType = rawType === "acik" || rawType === "ic" ? rawType : null;
    return [{
      text: sourceText,
      type: sourceType,
      url: text(raw?.url),
      claim: text(raw?.iddia),
    }];
  });
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

export function normalizeProfileNote(value: unknown): string | null {
  return text(value);
}

export function normalizeSchoolStructure(
  meta: Record<string, unknown>
): SchoolStructureRow[] {
  const rows = SCHOOL_STRUCTURE_FIELDS.flatMap(([key, label]) => {
    const value = text(meta[key]);
    return value ? [{ key, label, value }] : [];
  });
  const ownKitIndex = rows.findIndex(({ key, value }) =>
    key === "kendi_kiti" && !value.toLocaleLowerCase("tr-TR").startsWith("yok")
  );
  if (ownKitIndex > 0) {
    const [ownKit] = rows.splice(ownKitIndex, 1);
    rows.unshift(ownKit);
  }
  return rows;
}

export function normalizeNotFound(value: unknown): ProfileNotFoundItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const raw = record(item);
    const itemText = text(raw?.madde) ?? text(item);
    if (!itemText) return [];
    const rawType = text(raw?.tur);
    const type = rawType === "bulunamadi" || rawType === "bakilamadi" || rawType === "aranmadi"
      ? rawType
      : null;
    return [{ text: itemText, type }];
  });
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
