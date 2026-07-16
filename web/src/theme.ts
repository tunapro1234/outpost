import type { EntityType, Status } from "./types";

export const TYPE_COLORS: Record<EntityType, string> = {
  person: "#5ba8f5",
  company: "#f5a623",
  institution: "#a78bfa",
  school: "#34d399",
  channel: "#f472b6",
};

export const TYPE_LABELS: Record<EntityType, string> = {
  person: "Kişi",
  company: "Şirket",
  institution: "Kurum",
  school: "Okul",
  channel: "Kanal",
};

export const STATUS_LABELS: Record<Status, string> = {
  aday: "Aday",
  arastirildi: "Araştırıldı",
  taslak: "Taslak",
  "onay-bekliyor": "Onay bekliyor",
  gonderildi: "Gönderildi",
  cevap: "Cevap",
  randevu: "Randevu",
  red: "Red",
  pas: "Pas",
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

// Ring / status colors on the dark canvas.
export const STATUS_COLORS: Record<Status, string> = {
  aday: "#64748b",
  arastirildi: "#7c93b3",
  taslak: "#eab308",
  "onay-bekliyor": "#f59e0b",
  gonderildi: "#fb923c",
  cevap: "#22c55e",
  randevu: "#10b981",
  red: "#b91c1c",
  pas: "#4b5563",
};

export function statusColor(status?: Status | null): string | null {
  if (!status) return null;
  return STATUS_COLORS[status] ?? null;
}
