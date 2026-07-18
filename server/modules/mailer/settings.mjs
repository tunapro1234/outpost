import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_SCHEDULE, mergeSchedule } from "./schedule.mjs";

// Mail ayarları. approval_threshold (Tuna 2026-07-17): skor-bazlı otomatik onay.
// schedule/dispatch (2026-07-18): onaylanan mail ANINDA gitmez — alıcı saat
// dilimine göre iyi bir saate schedule edilir, rolling gönderilir; dispatch_mode
// varsayılan "dry_run" (hiçbir şey dışarı çıkmaz).
export const DEFAULT_MAIL_SETTINGS = Object.freeze({
  approval_threshold: 55,
  dispatch_mode: "dry_run",
  cold_after_days: 5,
  followup_gap_days: 3,
  daily_max_sends: 0, // 0 = sınırsız; günlük gönderim tavanı (mailler hazır olsa bile)
  schedule: DEFAULT_SCHEDULE,
});

const DISPATCH_MODES = new Set(["dry_run", "brevo"]);

function settingsPath(workspace) {
  return path.join(workspace.directory, "mails", "settings.json");
}

function clampInt(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function normalize(parsed) {
  const threshold = Number(parsed?.approval_threshold);
  return {
    approval_threshold: Number.isFinite(threshold)
      ? Math.min(100, Math.max(0, threshold))
      : DEFAULT_MAIL_SETTINGS.approval_threshold,
    dispatch_mode: DISPATCH_MODES.has(parsed?.dispatch_mode)
      ? parsed.dispatch_mode
      : DEFAULT_MAIL_SETTINGS.dispatch_mode,
    cold_after_days: clampInt(parsed?.cold_after_days, DEFAULT_MAIL_SETTINGS.cold_after_days, 1, 60),
    followup_gap_days: clampInt(parsed?.followup_gap_days, DEFAULT_MAIL_SETTINGS.followup_gap_days, 1, 30),
    daily_max_sends: clampInt(parsed?.daily_max_sends, DEFAULT_MAIL_SETTINGS.daily_max_sends, 0, 100000),
    schedule: mergeSchedule(parsed?.schedule),
  };
}

export async function readMailSettings(workspace, { fileSystem = fs } = {}) {
  if (!workspace?.directory) return normalize({});
  try {
    return normalize(JSON.parse(await fileSystem.readFile(settingsPath(workspace), "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return normalize({});
    throw error;
  }
}

export async function writeMailSettings(workspace, settings, { fileSystem = fs } = {}) {
  // Kısmi güncelleme: gelen alanlar mevcut ayarların üzerine biner, normalize edilir.
  const current = await readMailSettings(workspace, { fileSystem });
  if (settings?.approval_threshold !== undefined) {
    const threshold = Number(settings.approval_threshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
      const error = new Error("approval_threshold 0-100 arasında olmalı");
      error.statusCode = 400;
      throw error;
    }
  }
  if (settings?.dispatch_mode !== undefined && !DISPATCH_MODES.has(settings.dispatch_mode)) {
    const error = new Error("dispatch_mode dry_run veya brevo olmalı");
    error.statusCode = 400;
    throw error;
  }
  const next = normalize({
    ...current,
    ...settings,
    schedule: settings?.schedule ? { ...current.schedule, ...settings.schedule } : current.schedule,
  });
  const file = settingsPath(workspace);
  await fileSystem.mkdir(path.dirname(file), { recursive: true });
  await fileSystem.writeFile(file, JSON.stringify(next, null, 2), "utf8");
  return next;
}
