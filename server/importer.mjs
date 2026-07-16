#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import yaml from "js-yaml";
import { serializeMarkdown, TYPE_DIRECTORIES } from "./lib/vault.mjs";
import { slugify } from "./lib/slug.mjs";

const SOURCE_DIRECTORIES = {
  kisiler: { type: "person" },
  okullar: { type: "school" },
  kanallar: { type: "channel" },
  kurumlar: { type: null },
};

const FIELD_MAP = {
  rol: "role",
  yakinlik: "closeness",
  "mezuniyet-okul": "alumni_school",
  "mezuniyet-yil": "alumni_year",
  "mezuniyet-bolum": "alumni_dept",
  "mail-kaynak": "mail_source",
  kategori: "subtype",
  sehir: "city",
  ilce: "district",
  kanca: "hook",
  durum: "status",
  skor: "score",
  tel: "phone",
};

const COMPANY_CATEGORIES = new Set(["atolye", "tedarikci"]);
const INSTITUTION_CATEGORIES = new Set(["bilim-merkezi", "vakif", "devlet"]);

async function walkMarkdown(root) {
  const files = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "tr"))) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(fullPath);
    }
  }
  await visit(root);
  return files;
}

async function existingIds(targetVault) {
  const ids = new Set();
  for (const directory of Object.values(TYPE_DIRECTORIES)) {
    for (const filePath of await walkMarkdown(path.join(targetVault, directory))) {
      ids.add(path.basename(filePath, ".md"));
    }
  }
  return ids;
}

function institutionType(category) {
  if (COMPANY_CATEGORIES.has(category)) return "company";
  if (INSTITUTION_CATEGORIES.has(category)) return "institution";
  if (category === "kolej") return "school";
  return "company";
}

function displayName(parsed, filePath) {
  if (typeof parsed.data.name === "string" && parsed.data.name.trim()) {
    return parsed.data.name.trim();
  }
  const heading = /^#\s+(.+?)\s*$/m.exec(parsed.content);
  return heading?.[1]?.trim() || path.basename(filePath, path.extname(filePath));
}

function duplicateTopLevelKeys(frontmatter) {
  const seen = new Set();
  const duplicates = new Set();
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = /^([^\s#][^:]*):(?:\s|$)/.exec(line);
    if (!match) continue;
    const key = match[1].trim();
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}

function mapMeta(sourceMeta, sourceDirectory, name, report, relativePath) {
  const category =
    typeof sourceMeta.kategori === "string"
      ? sourceMeta.kategori.trim().toLocaleLowerCase("tr-TR")
      : "";
  let type = SOURCE_DIRECTORIES[sourceDirectory].type;
  if (sourceDirectory === "kurumlar") {
    type = institutionType(category);
    if (!category || (!COMPANY_CATEGORIES.has(category) &&
      !INSTITUTION_CATEGORIES.has(category) && category !== "kolej")) {
      report.warnings.push(
        `${relativePath}: bilinmeyen/boş kurum kategorisi "${category || "(boş)"}"; company seçildi`,
      );
    }
  }
  if (category) {
    report.categoryDistribution[category] =
      (report.categoryDistribution[category] ?? 0) + 1;
  }

  const mapped = { type, name };
  for (const [key, value] of Object.entries(sourceMeta)) {
    if (key === "tip" || key === "name") continue;
    mapped[FIELD_MAP[key] ?? key] = value;
  }
  if (sourceDirectory === "kurumlar" && category === "kolej") mapped.subtype = "kolej";
  return mapped;
}

export async function importVault(sourceVault, targetVault) {
  const source = path.resolve(sourceVault);
  const target = path.resolve(targetVault);
  if (source === target) throw new Error("Kaynak ve hedef vault aynı olamaz");
  const report = {
    source,
    target,
    imported: 0,
    byType: {},
    categoryDistribution: {},
    skipped: [],
    warnings: [],
  };
  const usedIds = await existingIds(target);
  const files = await walkMarkdown(source);

  for (const filePath of files) {
    const relativePath = path.relative(source, filePath);
    const [sourceDirectory] = relativePath.split(path.sep);
    if (/^00-.*\.md$/i.test(path.basename(filePath))) {
      report.skipped.push(`${relativePath}: MOC`);
      continue;
    }
    if (!SOURCE_DIRECTORIES[sourceDirectory]) {
      report.skipped.push(`${relativePath}: desteklenmeyen klasör`);
      continue;
    }

    try {
      const parsed = matter(await fs.readFile(filePath, "utf8"), {
        json: true,
        schema: yaml.JSON_SCHEMA,
      });
      const duplicateKeys = duplicateTopLevelKeys(parsed.matter);
      if (duplicateKeys.length) {
        report.warnings.push(
          `${relativePath}: yinelenen YAML alanlarında son değer kullanıldı (${duplicateKeys.join(", ")})`,
        );
      }
      const name = displayName(parsed, filePath);
      const meta = mapMeta(parsed.data, sourceDirectory, name, report, relativePath);
      let id = slugify(name) || "entity";
      const base = id;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${base}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(id);
      const directory = path.join(target, TYPE_DIRECTORIES[meta.type]);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(
        path.join(directory, `${id}.md`),
        serializeMarkdown(parsed.content, meta),
        { encoding: "utf8", flag: "wx" },
      );
      report.imported += 1;
      report.byType[meta.type] = (report.byType[meta.type] ?? 0) + 1;
    } catch (error) {
      report.skipped.push(`${relativePath}: ${error.message}`);
    }
  }
  return report;
}

async function main() {
  const [, , source, target] = process.argv;
  if (!source || !target) {
    console.error("Kullanım: node server/importer.mjs <kaynak-vault> <hedef-vault>");
    process.exitCode = 1;
    return;
  }
  const report = await importVault(source, target);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
