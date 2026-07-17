import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const SECTION_IDS = Object.freeze([
  "kpis",
  "prompt",
  "maildrafts",
  "mailchart",
  "types",
  "activity",
]);
const SECTION_ID_SET = new Set(SECTION_IDS);

function fail(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

export function defaultDashboard() {
  return {
    sections: SECTION_IDS.map((id) => ({ id, visible: true })),
    notes: {},
  };
}

export function validateDashboard(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Dashboard düzeni nesne olmalı");
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "sections" && key !== "notes")) {
    fail("Dashboard düzeninde bilinmeyen alan var");
  }
  if (!Array.isArray(value.sections) || value.sections.length !== SECTION_IDS.length) {
    fail("sections tüm dashboard bölümlerini içermeli");
  }

  const seen = new Set();
  const sections = value.sections.map((section) => {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      fail("Her dashboard bölümü nesne olmalı");
    }
    if (Object.keys(section).some((key) => key !== "id" && key !== "visible")) {
      fail("Dashboard bölümünde bilinmeyen alan var");
    }
    if (typeof section.id !== "string" || !SECTION_ID_SET.has(section.id)) {
      fail(`Bilinmeyen dashboard bölümü: ${String(section.id)}`);
    }
    if (seen.has(section.id)) fail(`Dashboard bölümü yinelenemez: ${section.id}`);
    if (typeof section.visible !== "boolean") {
      fail(`${section.id}.visible boolean olmalı`);
    }
    if (section.id === "prompt" && !section.visible) {
      fail("prompt bölümü gizlenemez");
    }
    seen.add(section.id);
    return { id: section.id, visible: section.visible };
  });

  if (!value.notes || typeof value.notes !== "object" || Array.isArray(value.notes)) {
    fail("notes nesne olmalı");
  }
  const noteEntries = Object.entries(value.notes);
  if (noteEntries.length > 40) fail("notes en fazla 40 anahtar içerebilir");
  const notes = {};
  for (const [key, note] of noteEntries) {
    if (typeof note !== "string") fail(`notes.${key} metin olmalı`);
    notes[key] = note;
  }

  return { sections, notes };
}

export function dashboardPath(workspace, username) {
  return path.join(workspace.directory, "dashboards", `${username}.json`);
}

export async function readDashboard(workspace, username, { fileSystem = fs } = {}) {
  try {
    const source = await fileSystem.readFile(dashboardPath(workspace, username), "utf8");
    return validateDashboard(JSON.parse(source));
  } catch (error) {
    if (error?.code === "ENOENT") return defaultDashboard();
    if (error instanceof SyntaxError) {
      throw new Error(`Dashboard düzeni okunamadı: ${error.message}`);
    }
    throw error;
  }
}

export async function writeDashboard(workspace, username, value, { fileSystem = fs } = {}) {
  const layout = validateDashboard(value);
  const target = dashboardPath(workspace, username);
  const directory = path.dirname(target);
  await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 });
  await fileSystem.chmod(directory, 0o700);
  const temporary = path.join(
    directory,
    `.${username}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    await fileSystem.writeFile(temporary, `${JSON.stringify(layout, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fileSystem.rename(temporary, target);
  } finally {
    await fileSystem.unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  return layout;
}
