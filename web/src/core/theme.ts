import type { EntityType, Status } from "./types";

export type ThemeName = "dark" | "light";

// ---- type palette -------------------------------------------------------
// Restrained, hue-distinct, non-neon. Two variants so both the neutral-dark
// canvas and the white canvas keep enough contrast without shifting identity.
const TYPE_DARK: Record<EntityType, string> = {
  person: "#6fa8cc", // muted steel blue
  company: "#d3a24e", // warm ochre
  institution: "#b088c4", // soft mauve
  school: "#6fb58a", // sage green
  channel: "#cf7d97", // dusty rose
};

const TYPE_LIGHT: Record<EntityType, string> = {
  person: "#2f6d94",
  company: "#a9741a",
  institution: "#7d4f96",
  school: "#2f7d52",
  channel: "#a13d63",
};

export function typeColors(theme: ThemeName): Record<EntityType, string> {
  return theme === "light" ? TYPE_LIGHT : TYPE_DARK;
}

// Legacy constant (dark) kept for any static references.
export const TYPE_COLORS = TYPE_DARK;

export const TYPE_LABELS: Record<EntityType, string> = {
  person: "Person",
  company: "Company",
  institution: "Institution",
  school: "School",
  channel: "Channel",
};

export const TYPE_ORDER: EntityType[] = [
  "person",
  "company",
  "institution",
  "school",
  "channel",
];

export const STATUS_LABELS: Record<Status, string> = {
  aday: "Lead",
  arastirildi: "Researched",
  taslak: "Draft",
  "onay-bekliyor": "Pending approval",
  gonderildi: "Sent",
  cevap: "Replied",
  randevu: "Meeting",
  red: "Rejected",
  pas: "Passed",
};

export const STATUS_ORDER: Status[] = [
  "aday",
  "arastirildi",
  "taslak",
  "onay-bekliyor",
  "gonderildi",
  "cevap",
  "randevu",
  "red",
  "pas",
];

// Semantic status progression (grey -> amber -> green -> red). Tuned to read
// on both the neutral dark and the light canvas.
const STATUS_DARK: Record<Status, string> = {
  aday: "#7c7c86",
  arastirildi: "#9aa0ab",
  taslak: "#d6b74e",
  "onay-bekliyor": "#e0973f",
  gonderildi: "#e08243",
  cevap: "#5bb87e",
  randevu: "#3fae86",
  red: "#c5544f",
  pas: "#5a5a62",
};

const STATUS_LIGHT: Record<Status, string> = {
  aday: "#6b6b74",
  arastirildi: "#7f8590",
  taslak: "#a9821a",
  "onay-bekliyor": "#b46a17",
  gonderildi: "#b45c1f",
  cevap: "#2f8f57",
  randevu: "#238066",
  red: "#a63a35",
  pas: "#4a4a52",
};

export function statusColors(theme: ThemeName): Record<Status, string> {
  return theme === "light" ? STATUS_LIGHT : STATUS_DARK;
}

export const STATUS_COLORS = STATUS_DARK;

export function statusColor(
  status?: Status | null,
  theme: ThemeName = "dark"
): string | null {
  if (!status) return null;
  return statusColors(theme)[status] ?? null;
}
