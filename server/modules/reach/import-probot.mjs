#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WorkspaceRegistry } from "../../lib/config.mjs";
import { normalizeSearch, slugify } from "../../lib/slug.mjs";
import {
  mailDedupKey,
  mailId,
  readMailLog,
  vaultMailRecords,
} from "./mails.mjs";

function stripNonRecords(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "");
}

export function parseRecordBlocks(source) {
  const clean = stripNonRecords(source);
  const starts = [...clean.matchAll(/^##\s+Kayıt\s*$/gimu)];
  const records = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index].index + starts[index][0].length;
    const end = starts[index + 1]?.index ?? clean.length;
    const section = clean.slice(start, end);
    const fields = {};
    for (const line of section.split(/\r?\n/)) {
      const match = /^\s*-\s+([^:]+):\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      fields[normalizeSearch(match[1]).replace(/\s+/g, "-")] = match[2].trim();
    }
    records.push(fields);
  }
  return records;
}

function entityResolver(index) {
  const byName = new Map();
  const bySlug = new Map();
  const byMail = new Map();
  for (const entity of index.entities.values()) {
    byName.set(normalizeSearch(entity.meta.name), entity);
    bySlug.set(slugify(entity.meta.name), entity);
    bySlug.set(normalizeSearch(entity.id), entity);
    if (typeof entity.meta.mail === "string") {
      for (const address of entity.meta.mail.split(/[;,\s]+/)) {
        if (address.includes("@")) byMail.set(address.toLowerCase(), entity);
      }
    }
  }
  return {
    institution(name) {
      if (typeof name !== "string") return null;
      return byName.get(normalizeSearch(name)) ?? bySlug.get(slugify(name)) ?? null;
    },
    address(address) {
      return typeof address === "string" ? byMail.get(address.toLowerCase()) ?? null : null;
    },
  };
}

function outreachRecord(fields, direction, resolver, workspace) {
  const address = direction === "out" ? fields.alici : fields.gonderen;
  const institution = resolver.institution(fields.kurum);
  const addressee = resolver.address(address);
  const entity = institution ?? addressee;
  if (!entity || !fields.tarih || !fields.konu) return null;

  const record = {
    entity_id: entity.id,
    direction,
    date: fields.tarih,
    from: direction === "out"
      ? workspace.config.mail_from ?? "Probot Studio"
      : address ?? null,
    to: direction === "out"
      ? address ?? null
      : workspace.config.mail_to ?? "Probot Studio",
    subject: fields.konu,
    summary: fields.ozet ?? fields.konu,
    source: "import",
  };
  if (addressee?.meta.type === "person") record.person_id = addressee.id;
  if (fields.utm) record.utm = fields.utm;
  record.id = mailId(record);
  return record;
}

async function sourceRecords(filePath, direction, resolver, workspace, report) {
  const source = await fs.readFile(filePath, "utf8");
  const records = [];
  for (const fields of parseRecordBlocks(source)) {
    if (direction === "out" && normalizeSearch(fields.durum) !== "gonderildi") {
      report.ignored += 1;
      continue;
    }
    const record = outreachRecord(fields, direction, resolver, workspace);
    if (!record) {
      report.unmatched.push({
        file: path.basename(filePath),
        kurum: fields.kurum ?? null,
        address: fields.alici ?? fields.gonderen ?? null,
      });
      continue;
    }
    records.push(record);
  }
  return records;
}

export async function importProbot({
  workspace,
  outreachPath = "/srv/probot/outreach",
  write = true,
} = {}) {
  if (!workspace) throw new Error("workspace zorunlu");
  if (!workspace.mailsPath) throw new Error("workspace mails/log.jsonl yolu yok");
  const report = {
    workspace: workspace.id,
    records: 0,
    new_records: 0,
    matched_entities: 0,
    by_source: { sent: 0, replies: 0, vault: 0 },
    ignored: 0,
    vault_non_traffic_skipped: 0,
    unmatched: [],
    output: workspace.mailsPath,
  };
  const resolver = entityResolver(workspace.index);
  const sent = await sourceRecords(
    path.join(outreachPath, "gonderilen.md"),
    "out",
    resolver,
    workspace,
    report,
  );
  const replies = await sourceRecords(
    path.join(outreachPath, "cevaplar.md"),
    "in",
    resolver,
    workspace,
    report,
  );
  const allVaultRows = vaultMailRecords(workspace.index, { allEntities: true });
  const vault = allVaultRows.filter((mail) => ["in", "out"].includes(mail.direction));
  report.vault_non_traffic_skipped = allVaultRows.length - vault.length;
  report.by_source = {
    sent: sent.length,
    replies: replies.length,
    vault: vault.length,
  };

  const existing = await readMailLog(workspace.mailsPath);
  const byKey = new Map(existing.map((record) => [mailDedupKey(record), record]));
  const before = byKey.size;
  for (const record of [...sent, ...replies, ...vault]) {
    const key = mailDedupKey(record);
    if (!byKey.has(key)) byKey.set(key, record);
  }
  const records = [...byKey.values()];
  report.records = records.length;
  report.new_records = records.length - before;
  report.matched_entities = new Set(records.map((record) => record.entity_id)).size;

  if (write) {
    await fs.mkdir(path.dirname(workspace.mailsPath), { recursive: true });
    const temporary = `${workspace.mailsPath}.tmp-${process.pid}`;
    await fs.writeFile(
      temporary,
      records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""),
      "utf8",
    );
    await fs.rename(temporary, workspace.mailsPath);
  }
  return report;
}

async function main() {
  const workspaceRoot = path.resolve(
    process.argv[2] ?? "/srv/outpost/workspaces/probot",
  );
  const outreachPath = path.resolve(process.argv[3] ?? "/srv/probot/outreach");
  const registry = await WorkspaceRegistry.load({
    workspacesPath: path.dirname(workspaceRoot),
    defaultWorkspace: path.basename(workspaceRoot),
    outpostVault: null,
    watch: false,
  });
  try {
    const workspace = registry.get(path.basename(workspaceRoot));
    console.log(JSON.stringify(await importProbot({ workspace, outreachPath }), null, 2));
  } finally {
    await registry.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
