import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import chokidar from "chokidar";
import yaml from "js-yaml";
import { normalizeSearch, slugify } from "./slug.mjs";

export const TYPE_DIRECTORIES = {
  person: "people",
  company: "companies",
  institution: "institutions",
  school: "schools",
  channel: "channels",
};

const DIRECTORY_TYPES = Object.fromEntries(
  Object.entries(TYPE_DIRECTORIES).map(([type, directory]) => [directory, type]),
);
const VALID_TYPES = new Set(Object.keys(TYPE_DIRECTORIES));
const WATCH_BATCH_MS = 150;

function outsideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function unsafeVaultPath(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

// Vaults mounted in place (an Obsidian vault another tool owns) are registered
// here so every write path in the app fails loudly instead of touching them.
const READ_ONLY_VAULTS = new Set();

export function setVaultReadOnly(vaultPath, readOnly = true) {
  const resolved = path.resolve(vaultPath);
  if (readOnly) READ_ONLY_VAULTS.add(resolved);
  else READ_ONLY_VAULTS.delete(resolved);
}

export function isVaultReadOnly(vaultPath) {
  return READ_ONLY_VAULTS.has(path.resolve(vaultPath));
}

export function assertVaultWritable(vaultPath) {
  if (!isVaultReadOnly(vaultPath)) return;
  const error = new Error("Vault salt-okunur bağlandı; yazma reddedildi");
  error.statusCode = 403;
  throw error;
}

export async function assertSafeVaultPath(
  vaultPath,
  filePath,
  { allowMissing = false, intent = "write" } = {},
) {
  if (intent !== "read") assertVaultWritable(vaultPath);
  const lexicalRoot = path.resolve(vaultPath);
  const lexicalTarget = path.resolve(filePath);
  if (outsideRoot(lexicalRoot, lexicalTarget)) {
    throw unsafeVaultPath("Vault yolu kök dışında");
  }

  const canonicalRoot = await fs.realpath(lexicalRoot);
  for (
    let directory = path.dirname(lexicalTarget);
    directory !== lexicalRoot && !outsideRoot(lexicalRoot, directory);
    directory = path.dirname(directory)
  ) {
    try {
      if ((await fs.lstat(directory)).isSymbolicLink()) {
        throw unsafeVaultPath("Vault symlink dizinleri reddedilir");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  try {
    const stat = await fs.lstat(lexicalTarget);
    if (stat.isSymbolicLink()) throw unsafeVaultPath("Vault symlink dosyaları reddedilir");
    const canonicalTarget = await fs.realpath(lexicalTarget);
    if (outsideRoot(canonicalRoot, canonicalTarget)) {
      throw unsafeVaultPath("Vault dosyası canonical kök dışında");
    }
  } catch (error) {
    if (error.code !== "ENOENT" || !allowMissing) throw error;
    const canonicalParent = await fs.realpath(path.dirname(lexicalTarget));
    if (outsideRoot(canonicalRoot, canonicalParent)) {
      throw unsafeVaultPath("Vault hedef dizini canonical kök dışında");
    }
  }
  return lexicalTarget;
}

export function cleanWikilink(raw) {
  return raw.split("|", 1)[0].split("#", 1)[0].trim();
}

/**
 * Split a markdown body into the line ranges covered by every heading matching
 * `headingPattern`. Exported so vault adapters can reuse the same section logic
 * with their own heading vocabulary.
 */
export function headingSections(body, headingPattern) {
  const lines = String(body ?? "").split(/\r?\n/);
  const sections = [];

  for (let index = 0; index < lines.length; index += 1) {
    const heading = headingPattern.exec(lines[index].trim());
    if (!heading) continue;

    const level = heading[1].length;
    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextHeading = /^(#{1,6})\s+/.exec(lines[cursor].trim());
      if (nextHeading && nextHeading[1].length <= level) {
        end = cursor;
        break;
      }
    }
    sections.push({ start: index, end });
    index = end - 1;
  }
  return { lines, sections };
}

function relationSections(body) {
  return headingSections(body, /^(#{2,6})\s+İlişkiler\s*$/iu);
}

export function extractMails(body) {
  const lines = body.split(/\r?\n/);
  const mails = [];

  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^(#{2,6})\s+Mailler\s*$/iu.exec(lines[index].trim());
    if (!heading) continue;

    const level = heading[1].length;
    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextHeading = /^(#{1,6})\s+/.exec(lines[cursor].trim());
      if (nextHeading && nextHeading[1].length <= level) {
        end = cursor;
        break;
      }
    }

    for (let cursor = index + 1; cursor < end; cursor += 1) {
      const raw = lines[cursor];
      if (!raw.trim()) continue;
      const outgoing = /^-\s+(\d{4}-\d{2}-\d{2})\s+(?:→|->)\s+giden:\s*(.*)$/iu.exec(raw.trim());
      const incoming = /^-\s+(\d{4}-\d{2}-\d{2})\s+(?:←|<-)\s+gelen:\s*(.*)$/iu.exec(raw.trim());
      const parsed = outgoing ?? incoming;
      mails.push(parsed
        ? {
            date: parsed[1],
            direction: outgoing ? "out" : "in",
            summary: parsed[2],
            raw,
          }
        : { date: null, direction: "unknown", summary: raw.trim(), raw });
    }
    index = end - 1;
  }

  return mails;
}

export function extractLinks(body) {
  const relations = [];
  const mentions = [];
  const { lines, sections } = relationSections(body);
  const relationLineIndexes = new Set();

  for (const section of sections) {
    for (let index = section.start + 1; index < section.end; index += 1) {
      const line = lines[index];
      if (!/^\s*-\s+/.test(line)) continue;
      const link = /\[\[([^\]]+)\]\]/.exec(line);
      if (!link) continue;
      const dashAt = line.slice(link.index + link[0].length).search(/\s[—–]\s/);
      if (dashAt < 0) continue;
      const suffix = line.slice(link.index + link[0].length);
      const dash = suffix.match(/\s[—–]\s/);
      const label = suffix.slice((dash?.index ?? 0) + (dash?.[0].length ?? 0)).trim();
      relations.push({ target: cleanWikilink(link[1]), label });
      relationLineIndexes.add(index);
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (relationLineIndexes.has(index)) continue;
    for (const match of lines[index].matchAll(/\[\[([^\]]+)\]\]/g)) {
      mentions.push({ target: cleanWikilink(match[1]), label: null });
    }
  }

  return { relations, mentions };
}

export function parseMarkdown(source, filePath = "") {
  const parsed = matter(source, { schema: yaml.JSON_SCHEMA });
  const id = path.basename(filePath, path.extname(filePath));
  return {
    id,
    meta: parsed.data,
    body: parsed.content,
    filePath,
    links: extractLinks(parsed.content),
    mails: extractMails(parsed.content),
  };
}

export function serializeMarkdown(body, meta) {
  return matter.stringify(String(body ?? ""), meta);
}

export async function markdownFiles(directory) {
  try {
    return (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => path.join(directory, entry.name))
      .sort((left, right) => left.localeCompare(right, "tr"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

/**
 * The built-in vault layout: `<vault>/<type-directory>/<slug>.md`, English
 * frontmatter, no translation. Every other layout is expressed as an adapter
 * with the same three hooks so `VaultIndex` stays layout-agnostic.
 *
 *   listFiles(vaultPath) -> absolute .md paths to index
 *   accepts(vaultPath, absolutePath) -> is this file ours?
 *   normalize(parsedEntity) -> entity to index, or null to skip silently
 */
export const DEFAULT_VAULT_ADAPTER = {
  name: "default",
  async listFiles(vaultPath) {
    const files = [];
    for (const directory of Object.values(TYPE_DIRECTORIES)) {
      files.push(...await markdownFiles(path.join(vaultPath, directory)));
    }
    return files;
  },
  accepts(vaultPath, absolutePath) {
    const relative = path.relative(vaultPath, absolutePath);
    return Boolean(DIRECTORY_TYPES[relative.split(path.sep)[0]]);
  },
  normalize: (entity) => entity,
};

export class VaultIndex {
  constructor(vaultPath, { adapter = DEFAULT_VAULT_ADAPTER, readOnly = false } = {}) {
    this.vaultPath = path.resolve(vaultPath);
    this.adapter = adapter ?? DEFAULT_VAULT_ADAPTER;
    this.readOnly = Boolean(readOnly);
    if (this.readOnly) setVaultReadOnly(this.vaultPath, true);
    this.entities = new Map();
    this.pathToId = new Map();
    this.edges = [];
    this.unresolved = new Map();
    this.degrees = new Map();
    this.warnings = [];
    this.watcher = null;
    this.watcherTimer = null;
    this.watcherEvents = new Map();
    this.watcherFlush = Promise.resolve();
  }

  async load() {
    this.entities.clear();
    this.pathToId.clear();
    this.warnings = [];
    for (const filePath of await this.adapter.listFiles(this.vaultPath)) {
      await this.loadFile(filePath, false);
    }
    this.rebuildGraph();
    return this;
  }

  async loadFile(filePath, rebuild = true) {
    const absolutePath = path.resolve(filePath);
    const relative = path.relative(this.vaultPath, absolutePath);
    if (!absolutePath.toLowerCase().endsWith(".md")) return;
    if (!this.adapter.accepts(this.vaultPath, absolutePath)) return;

    const previousId = this.pathToId.get(absolutePath);
    try {
      await assertSafeVaultPath(this.vaultPath, absolutePath, { intent: "read" });
      const source = await fs.readFile(absolutePath, "utf8");
      const parsed = (this.adapter.parse ?? parseMarkdown)(source, absolutePath);
      if (parsed?.parseWarning) this.warnings.push(`${relative}: ${parsed.parseWarning}`);
      const entity = this.adapter.normalize(parsed);
      if (!entity) {
        // The adapter deliberately skips this file (index/MOC page, note, …).
        if (previousId) this.entities.delete(previousId);
        this.pathToId.delete(absolutePath);
        if (rebuild) this.rebuildGraph();
        return;
      }
      if (!entity.meta || typeof entity.meta !== "object") {
        throw new Error("frontmatter bulunamadı");
      }
      if (!VALID_TYPES.has(entity.meta.type)) {
        throw new Error(`geçersiz veya eksik type: ${entity.meta.type ?? "(boş)"}`);
      }
      if (typeof entity.meta.name !== "string" || !entity.meta.name.trim()) {
        throw new Error("name zorunlu");
      }
      if (previousId && previousId !== entity.id) this.entities.delete(previousId);
      const collision = this.entities.get(entity.id);
      if (collision && collision.filePath !== absolutePath) {
        throw new Error(`yinelenen entity id: ${entity.id}`);
      }
      this.entities.set(entity.id, entity);
      this.pathToId.set(absolutePath, entity.id);
    } catch (error) {
      if (previousId) this.entities.delete(previousId);
      this.pathToId.delete(absolutePath);
      this.warnings.push(`${relative}: ${error.message}`);
    }
    if (rebuild) this.rebuildGraph();
  }

  removeFile(filePath, rebuild = true) {
    const absolutePath = path.resolve(filePath);
    const id = this.pathToId.get(absolutePath);
    if (id) this.entities.delete(id);
    this.pathToId.delete(absolutePath);
    if (rebuild) this.rebuildGraph();
  }

  rebuildGraph() {
    const byName = new Map();
    const bySlug = new Map();
    for (const entity of this.entities.values()) {
      const nameKey = normalizeSearch(entity.meta.name);
      if (!byName.has(nameKey)) byName.set(nameKey, entity);
      bySlug.set(slugify(entity.meta.name), entity);
      bySlug.set(normalizeSearch(entity.id), entity);
    }

    const unresolved = new Map();
    const edgeByKey = new Map();
    const relationPairs = new Set();
    const pendingMentions = [];
    const resolveTarget = (target) =>
      byName.get(normalizeSearch(target)) ?? bySlug.get(slugify(target));
    const unorderedPair = (left, right) => [left, right].sort().join("\0");

    for (const entity of this.entities.values()) {
      const missing = [];
      for (const link of entity.links.relations) {
        const target = resolveTarget(link.target);
        if (!target) {
          missing.push(link.target);
          continue;
        }
        const directedPair = `${entity.id}\0${target.id}`;
        relationPairs.add(unorderedPair(entity.id, target.id));
        edgeByKey.set(`relation\0${directedPair}`, {
          source: entity.id,
          target: target.id,
          label: link.label || null,
          kind: "relation",
        });
      }
      for (const link of entity.links.mentions) {
        const target = resolveTarget(link.target);
        if (!target) {
          missing.push(link.target);
          continue;
        }
        pendingMentions.push({ source: entity.id, target: target.id });
      }
      unresolved.set(entity.id, [...new Set(missing)]);
    }

    for (const mention of pendingMentions) {
      const directedPair = `${mention.source}\0${mention.target}`;
      if (relationPairs.has(unorderedPair(mention.source, mention.target))) continue;
      edgeByKey.set(`mention\0${directedPair}`, {
        ...mention,
        label: null,
        kind: "mention",
      });
    }

    this.edges = [...edgeByKey.values()];
    this.unresolved = unresolved;
    this.degrees = new Map([...this.entities.keys()].map((id) => [id, 0]));
    for (const edge of this.edges) {
      this.degrees.set(edge.source, (this.degrees.get(edge.source) ?? 0) + 1);
      if (edge.target !== edge.source) {
        this.degrees.set(edge.target, (this.degrees.get(edge.target) ?? 0) + 1);
      }
    }
  }

  async startWatching() {
    if (this.watcher) return;
    this.watcher = chokidar.watch(this.vaultPath, {
      depth: 1,
      followSymlinks: false,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
    });
    this.watcher.on("add", (filePath) => this.queueWatcherEvent("load", filePath));
    this.watcher.on("change", (filePath) => this.queueWatcherEvent("load", filePath));
    this.watcher.on("unlink", (filePath) => this.queueWatcherEvent("unlink", filePath));
    await new Promise((resolve, reject) => {
      this.watcher.once("ready", resolve);
      this.watcher.once("error", reject);
    });
  }

  queueWatcherEvent(event, filePath) {
    this.watcherEvents.set(path.resolve(filePath), event);
    if (this.watcherTimer) clearTimeout(this.watcherTimer);
    this.watcherTimer = setTimeout(() => {
      this.watcherTimer = null;
      this.watcherFlush = this.watcherFlush
        .then(() => this.flushWatcherEvents())
        .catch((error) => this.warnings.push(`watcher: ${error.message}`));
    }, WATCH_BATCH_MS);
    this.watcherTimer.unref?.();
  }

  async flushWatcherEvents() {
    if (!this.watcherEvents.size) return;
    const events = [...this.watcherEvents];
    this.watcherEvents.clear();
    for (const [filePath, event] of events) {
      if (event === "unlink") this.removeFile(filePath, false);
      else await this.loadFile(filePath, false);
    }
    this.rebuildGraph();
  }

  async close() {
    await this.watcher?.close();
    this.watcher = null;
    if (this.watcherTimer) clearTimeout(this.watcherTimer);
    this.watcherTimer = null;
    await this.watcherFlush;
    await this.flushWatcherEvents();
  }

  entityDetail(id) {
    const entity = this.entities.get(id);
    if (!entity) return null;
    const relations = [];
    for (const edge of this.edges) {
      let relatedId;
      let direction;
      if (edge.source === id) {
        relatedId = edge.target;
        direction = "out";
      } else if (edge.target === id) {
        relatedId = edge.source;
        direction = "in";
      } else {
        continue;
      }
      const related = this.entities.get(relatedId);
      if (!related) continue;
      relations.push({
        id: related.id,
        name: related.meta.name,
        type: related.meta.type,
        label: edge.label,
        kind: edge.kind,
        direction,
      });
    }
    return {
      id: entity.id,
      meta: { ...entity.meta },
      body: entity.body,
      relations,
      unresolved: [...(this.unresolved.get(id) ?? [])],
    };
  }

  nextId(name) {
    const base = slugify(name) || "entity";
    let id = base;
    let suffix = 2;
    while (this.entities.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    return id;
  }
}
