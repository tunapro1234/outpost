import { promises as fs } from "node:fs";
import path from "node:path";
import { mailEntityIndex } from "../network/service.mjs";
import { readMailHeaders } from "./parser.mjs";

export const DEFAULT_MAIL_DATA = "/srv/mailserver/data/probotstudio.com";
export const DEFAULT_MAIL_INTERVAL_MS = 10 * 60 * 1000;

const MAILDIR_FOLDERS = [
  { segments: [".Sent", "new"], direction: "sent", folder: "Sent" },
  { segments: [".Sent", "cur"], direction: "sent", folder: "Sent" },
  { segments: ["new"], direction: "received", folder: "Inbox" },
  { segments: ["cur"], direction: "received", folder: "Inbox" },
];

function warn(onWarn, error, context) {
  onWarn?.(error, context);
}

async function directoryEntries(directory, { optional = false, onWarn, context } = {}) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (optional && error.code === "ENOENT") return [];
    warn(onWarn, error, context ?? directory);
    return [];
  }
}

function ingestKey(record) {
  return `${record.account.toLowerCase()}\0${record.id.toLowerCase()}`;
}

function unique(values) {
  return [...new Set(values)];
}

export async function scanMaildir(mailDataPath = DEFAULT_MAIL_DATA, { onWarn } = {}) {
  const report = {
    mailDataPath: path.resolve(mailDataPath),
    accounts: 0,
    scanned: 0,
    parsed: 0,
    unique: 0,
    duplicates: 0,
    failed: 0,
    unavailable: false,
  };
  let rootEntries;
  try {
    rootEntries = await fs.readdir(report.mailDataPath, { withFileTypes: true });
  } catch (error) {
    report.unavailable = true;
    warn(onWarn, error, `Maildir okunamadı: ${report.mailDataPath}`);
    return { records: [], report };
  }

  const accounts = rootEntries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
  report.accounts = accounts.length;
  const records = new Map();

  for (const account of accounts) {
    const accountPath = path.join(report.mailDataPath, account);
    for (const maildirFolder of MAILDIR_FOLDERS) {
      const directory = path.join(accountPath, ...maildirFolder.segments);
      const entries = await directoryEntries(directory, {
        optional: true,
        onWarn,
        context: `Maildir klasörü okunamadı: ${directory}`,
      });
      const files = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right, "en"));
      for (const name of files) {
        const filePath = path.join(directory, name);
        report.scanned += 1;
        try {
          const [headers, stat] = await Promise.all([
            readMailHeaders(filePath),
            fs.stat(filePath),
          ]);
          const record = {
            id: headers.id,
            account,
            direction: maildirFolder.direction,
            peer: maildirFolder.direction === "sent"
              ? unique([...headers.to, ...headers.cc])
              : headers.from,
            subject: headers.subject,
            date: headers.date ?? stat.mtime.toISOString(),
            folder: maildirFolder.folder,
          };
          report.parsed += 1;
          const key = ingestKey(record);
          if (records.has(key)) {
            report.duplicates += 1;
            continue;
          }
          records.set(key, record);
        } catch (error) {
          report.failed += 1;
          warn(onWarn, error, `Mail başlığı parse edilemedi: ${filePath}`);
        }
      }
    }
  }
  report.unique = records.size;
  return { records: [...records.values()], report };
}

function validRecord(record) {
  return record && typeof record === "object" && !Array.isArray(record) &&
    typeof record.id === "string" && record.id.length > 0 &&
    typeof record.account === "string" && record.account.length > 0 &&
    ["sent", "received"].includes(record.direction) &&
    Array.isArray(record.peer) && record.peer.every((value) => typeof value === "string") &&
    (record.subject === null || typeof record.subject === "string") &&
    typeof record.date === "string" && !Number.isNaN(new Date(record.date).getTime()) &&
    ["Inbox", "Sent"].includes(record.folder);
}

export async function readIngestedMailLog(filePath, { onWarn } = {}) {
  if (!filePath) return [];
  let source;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (!validRecord(record)) throw new Error("ingested mail şemasına uymuyor");
      records.push(record);
    } catch (error) {
      warn(onWarn, error, `${filePath}:${index + 1}`);
    }
  }
  return records;
}

async function needsLeadingNewline(filePath) {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const { size } = await handle.stat();
      if (!size) return false;
      const byte = Buffer.alloc(1);
      await handle.read(byte, 0, 1, size - 1);
      return byte[0] !== 10;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function appendIngestedMailLog(workspace, records, { onWarn } = {}) {
  const filePath = workspace.mailIngestedPath;
  const existing = await readIngestedMailLog(filePath, { onWarn });
  const known = new Set(existing.map(ingestKey));
  const additions = [];
  let duplicates = 0;
  for (const record of records) {
    const key = ingestKey(record);
    if (known.has(key)) {
      duplicates += 1;
      continue;
    }
    known.add(key);
    additions.push(record);
  }
  if (additions.length) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const prefix = await needsLeadingNewline(filePath) ? "\n" : "";
    await fs.appendFile(
      filePath,
      prefix + additions.map((record) => JSON.stringify(record)).join("\n") + "\n",
      "utf8",
    );
  }
  return { added: additions.length, existing: existing.length, duplicates };
}

export async function ingestedWorkspaceMails(workspace, { onWarn } = {}) {
  const records = await readIngestedMailLog(workspace.mailIngestedPath, { onWarn });
  const entitiesByAddress = mailEntityIndex(workspace.index);
  return records.map((record) => {
    const entity = record.peer.map((address) => entitiesByAddress.get(address.toLowerCase()))
      .find(Boolean) ?? null;
    const peer = record.peer.join(", ") || null;
    const adapted = {
      id: `maildir:${record.account}:${record.id}`,
      entity_id: entity?.id ?? null,
      direction: record.direction === "sent" ? "out" : "in",
      date: record.date,
      from: record.direction === "sent" ? record.account : peer,
      to: record.direction === "sent" ? peer : record.account,
      subject: record.subject,
      summary: record.subject ?? "(konu yok)",
      source: "import",
    };
    if (entity?.meta.type === "person") adapted.person_id = entity.id;
    return adapted;
  });
}

export class MailIngestor {
  constructor(registry, {
    mailDataPath = process.env.OUTPOST_MAIL_DATA ?? DEFAULT_MAIL_DATA,
    intervalMs = DEFAULT_MAIL_INTERVAL_MS,
    onWarn,
    scan = scanMaildir,
  } = {}) {
    this.registry = registry;
    this.mailDataPath = mailDataPath;
    this.intervalMs = intervalMs;
    this.onWarn = onWarn;
    this.scan = scan;
    this.timer = null;
    this.queue = Promise.resolve();
  }

  enqueue(task) {
    const pending = this.queue.then(task, task);
    this.queue = pending.catch(() => {});
    return pending;
  }

  async applyScan(workspace, scanned) {
    const written = await appendIngestedMailLog(workspace, scanned.records, {
      onWarn: this.onWarn,
    });
    return { ...scanned.report, ...written };
  }

  refresh(workspace) {
    return this.enqueue(async () => {
      const scanned = await this.scan(this.mailDataPath, { onWarn: this.onWarn });
      return this.applyScan(workspace, scanned);
    });
  }

  refreshAll() {
    return this.enqueue(async () => {
      const scanned = await this.scan(this.mailDataPath, { onWarn: this.onWarn });
      const reports = {};
      for (const workspace of this.registry.workspaces.values()) {
        reports[workspace.id] = await this.applyScan(workspace, scanned);
      }
      return reports;
    });
  }

  async start() {
    if (this.timer) return;
    await this.refreshAll();
    this.timer = setInterval(() => {
      void this.refreshAll().catch((error) => warn(this.onWarn, error, "Mail interval taraması başarısız"));
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.queue;
  }
}
