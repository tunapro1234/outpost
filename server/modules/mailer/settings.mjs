import { promises as fs } from "node:fs";
import path from "node:path";

// Mail onay eşiği (Tuna 2026-07-17): tam manuel onay yerine skor-bazlı ilerleme.
// score >= approval_threshold olan kişiler mail için otomatik onaylı sayılır;
// onaylı ama doğrulanmış maili olmayanlar "mail araştırılacak" kovasına düşer.
export const DEFAULT_MAIL_SETTINGS = Object.freeze({ approval_threshold: 55 });

function settingsPath(workspace) {
  return path.join(workspace.directory, "mails", "settings.json");
}

export async function readMailSettings(workspace, { fileSystem = fs } = {}) {
  if (!workspace?.directory) return { ...DEFAULT_MAIL_SETTINGS };
  try {
    const parsed = JSON.parse(await fileSystem.readFile(settingsPath(workspace), "utf8"));
    const threshold = Number(parsed?.approval_threshold);
    return {
      approval_threshold: Number.isFinite(threshold)
        ? Math.min(100, Math.max(0, threshold))
        : DEFAULT_MAIL_SETTINGS.approval_threshold,
    };
  } catch (error) {
    if (error.code === "ENOENT") return { ...DEFAULT_MAIL_SETTINGS };
    throw error;
  }
}

export async function writeMailSettings(workspace, settings, { fileSystem = fs } = {}) {
  const threshold = Number(settings?.approval_threshold);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    const error = new Error("approval_threshold 0-100 arasında olmalı");
    error.statusCode = 400;
    throw error;
  }
  const next = { approval_threshold: threshold };
  const file = settingsPath(workspace);
  await fileSystem.mkdir(path.dirname(file), { recursive: true });
  await fileSystem.writeFile(file, JSON.stringify(next, null, 2), "utf8");
  return next;
}
