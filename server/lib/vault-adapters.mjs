/**
 * Vault adapters — read foreign Obsidian vault schemas into the Outpost entity
 * model WITHOUT rewriting the vault on disk.
 *
 * An adapter is chosen per workspace via `adapter:` in its config.yaml. It only
 * ever runs on the read path (`VaultIndex.load` / `loadFile`); nothing here
 * writes. Workspaces that mount someone else's vault should also set
 * `read_only: true` so the app's write paths refuse the vault outright.
 */
import path from "node:path";
import {
  DEFAULT_VAULT_ADAPTER,
  cleanWikilink,
  extractLinks,
  extractMails,
  headingSections,
  markdownFiles,
  parseMarkdown,
} from "./vault.mjs";
import { slugify } from "./slug.mjs";

// ---------------------------------------------------------------------------
// tr-network: flat Turkish-frontmatter relationship vault
// ---------------------------------------------------------------------------
// Layout: every note is a flat `<vault>/<İsim>.md`. Frontmatter is Turkish
// (`tip`, `kategori`, `probot-iliskisi`, `bagli-kurum`, `sicaklik`, `durum`,
// `konum`, `etiketler`). Relations live under an `## İlişkiler…` heading, and a
// hub note can carry an `## Açtığı kişiler` section listing everyone it opened.

const TR_TYPES = {
  kisi: "person",
  kurum: "institution",
  okul: "school",
  sirket: "company",
  medya: "channel",
  yarisma: "institution",
};

// Notes that are documentation about the vault, not nodes in the graph.
const TR_SKIPPED_TYPES = new Set(["moc", "brif", "not", "index"]);

// `sicaklik` is a coarse warmth label. A MISSING field is not "belirsiz":
// ~a third of the people have no reading at all, and collapsing that to 0 would
// invent data. Missing => closeness stays absent (null downstream).
const TR_CLOSENESS = {
  sicak: 3,
  ilik: 2,
  soguk: 1,
  belirsiz: 0,
};

const TR_RELATION_HEADING = /^(#{2,6})\s+İlişkiler\b.*$/iu;
const TR_OPENED_HEADING = /^(#{2,6})\s+Açtığı\s+kişiler\b.*$/iu;
const TR_CONTACT_HEADING = /^(#{2,6})\s+İletişim\b.*$/iu;
const WIKILINK = /\[\[([^\]]+)\]\]/g;
const PHONE_SOURCES = new Set(["elden", "ocr", "web"]);
// How sure we are the contact details belong to THIS person. The risk with a
// hand-copied number is not a malformed number, it is reaching the wrong human.
const IDENTITY_CONFIDENCE = new Set(["iyi", "orta", "zayif"]);

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstHeadingName(body) {
  for (const line of String(body ?? "").split(/\r?\n/)) {
    const heading = /^#\s+(.+?)\s*$/.exec(line);
    if (heading) return heading[1].trim();
  }
  return null;
}

function tagList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const raw = text(value);
  return raw ? raw.split(",").map((item) => item.trim()).filter(Boolean) : null;
}

/** Relations: `- [[Hedef]] — etiket` under any `## İlişkiler…` heading. */
function trRelations(body) {
  const relations = [];
  const consumed = new Set();
  const { lines, sections } = headingSections(body, TR_RELATION_HEADING);
  for (const section of sections) {
    for (let index = section.start + 1; index < section.end; index += 1) {
      const line = lines[index];
      if (!/^\s*-\s+/.test(line)) continue;
      const link = /\[\[([^\]]+)\]\]/.exec(line);
      if (!link) continue;
      const suffix = line.slice(link.index + link[0].length);
      const dash = suffix.match(/\s[—–-]\s/);
      relations.push({
        target: cleanWikilink(link[1]),
        label: dash ? suffix.slice(dash.index + dash[0].length).trim() || null : null,
      });
      consumed.add(index);
    }
  }
  return { relations, consumed, lines };
}

/**
 * `## Açtığı kişiler` — a hub's outgoing referral edges ("kim kimi açtı").
 * The links are inline and `·`-separated rather than a bullet list. Lines that
 * open with `(` are second-ring annotations (`(ikinci halka: A→B)`) and belong
 * to the people named there, not to this hub, so they are skipped.
 */
function trOpenedRelations(body) {
  const relations = [];
  const consumed = new Set();
  const { lines, sections } = headingSections(body, TR_OPENED_HEADING);
  for (const section of sections) {
    for (let index = section.start + 1; index < section.end; index += 1) {
      const line = lines[index];
      if (!line.trim() || line.trim().startsWith("(")) continue;
      let matched = false;
      for (const match of line.matchAll(WIKILINK)) {
        relations.push({ target: cleanWikilink(match[1]), label: "açtı" });
        matched = true;
      }
      if (matched) consumed.add(index);
    }
  }
  return { relations, consumed };
}

/** `## İletişim` bullets: `📞 0506 …`, `✉️ a@b.c`, `🌐 site`. */
function trContact(body) {
  const contact = { phone: null, mail: null, site: null };
  const { lines, sections } = headingSections(body, TR_CONTACT_HEADING);
  for (const section of sections) {
    for (let index = section.start + 1; index < section.end; index += 1) {
      const line = lines[index].replace(/^\s*-\s*/, "").trim();
      if (!line || line === "—") continue;
      const mail = /([\w.+-]+@[\w-]+\.[\w.-]+)/.exec(line);
      if (mail) {
        contact.mail ??= mail[1];
        continue;
      }
      if (line.startsWith("📞")) {
        const value = line.slice("📞".length).trim();
        // "Tuna'da" / "Rüveyda'dan" means *someone holds it*, not a number.
        if (/\d/.test(value) && value.replace(/\D/g, "").length >= 7) contact.phone ??= value;
        continue;
      }
      if (line.startsWith("🌐")) contact.site ??= line.slice("🌐".length).trim();
    }
  }
  return contact;
}

function trNormalize(entity) {
  const source = entity.meta && typeof entity.meta === "object" ? entity.meta : {};
  const tip = text(source.tip)?.toLowerCase();
  if (!tip || TR_SKIPPED_TYPES.has(tip)) return null;
  const type = TR_TYPES[tip];
  if (!type) return null;

  const fileName = path.basename(entity.filePath, path.extname(entity.filePath));
  const name = firstHeadingName(entity.body) ?? fileName;

  const { relations, consumed, lines } = trRelations(entity.body);
  const opened = trOpenedRelations(entity.body);
  relations.push(...opened.relations);

  const org = text(source["bagli-kurum"]);
  if (org) relations.push({ target: org, label: "kurum" });

  const mentionSkip = new Set([...consumed, ...opened.consumed]);
  const mentions = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (mentionSkip.has(index)) continue;
    for (const match of lines[index].matchAll(WIKILINK)) {
      mentions.push({ target: cleanWikilink(match[1]), label: null });
    }
  }

  const contact = trContact(entity.body);
  const warmth = text(source.sicaklik)?.toLowerCase();
  const phone = text(source.telefon) ?? contact.phone;
  const declaredPhoneSource = text(source["telefon-kaynak"])?.toLowerCase();

  const category = text(source.kategori);
  // `kategori: lead-<kaynak>` encodes who opened the lead — a free filter axis.
  const leadSource = /^lead-(.+)$/i.exec(category ?? "")?.[1]?.trim() ?? null;
  const identity = text(source["kimlik-guveni"] ?? source.kimlik_guveni)?.toLowerCase();

  const meta = {
    type,
    name,
    // TR fields carried over verbatim where Outpost has no equivalent.
    durum: text(source.durum),
    kategori: category,
    lead_source: leadSource,
    // Outpost equivalents.
    subtype: category,
    role: text(source["probot-iliskisi"]),
    org,
    city: text(source.konum),
    location: text(source.konum),
    tags: tagList(source.etiketler),
    mail: contact.mail,
    mail_source: contact.mail ? "elden" : null,
    site: contact.site,
    // Manual-call fields. `phone` is display-only — see lib/outreach-guard.mjs.
    phone,
    phone_source: phone
      ? (PHONE_SOURCES.has(declaredPhoneSource) ? declaredPhoneSource : "elden")
      : null,
    contact_channel: phone ? "telefon" : contact.mail ? "mail" : contact.site ? "web" : null,
    kimlik_guveni: IDENTITY_CONFIDENCE.has(identity) ? identity : null,
    gun: text(source.gun),
    sira: Number.isInteger(source.sira) ? source.sira : null,
    // Original Turkish frontmatter, untouched, so nothing is lost in the UI.
    source_meta: { ...source },
  };
  // `sicaklik` absent => no closeness key at all (missing != "belirsiz"/0).
  if (warmth && warmth in TR_CLOSENESS) {
    meta.closeness = TR_CLOSENESS[warmth];
  }
  for (const [key, value] of Object.entries(meta)) {
    if (value === null) delete meta[key];
  }

  return {
    ...entity,
    id: slugify(fileName) || slugify(name) || entity.id,
    meta,
    links: { relations, mentions },
    mails: extractMails(entity.body),
  };
}

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Line-by-line frontmatter reader for notes whose YAML does not parse.
 *
 * A hand-maintained vault contains things like `bagli-kurum: "MBA okulu"
 * (Boğaziçi bağı?)` — meaningful to a human, invalid YAML. We cannot repair the
 * file (the vault is read-only and owned by someone else), and dropping the
 * person entirely would silently lose a real lead, so each `key: value` line is
 * read as a plain string instead. The caller surfaces a warning either way.
 */
function lenientFrontmatter(source, filePath) {
  const match = FRONTMATTER_BLOCK.exec(source);
  if (!match) return null;
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!field) continue;
    const raw = field[2].trim();
    if (!raw) continue;
    const list = /^\[(.*)\]$/.exec(raw);
    meta[field[1]] = list
      ? list[1].split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
      : raw.replace(/^["'](.*)["']$/, "$1");
  }
  const body = source.slice(match[0].length);
  return {
    id: path.basename(filePath, path.extname(filePath)),
    meta,
    body,
    filePath,
    links: extractLinks(body),
    mails: extractMails(body),
    parseWarning: "frontmatter YAML olarak okunamadı, satır satır okundu",
  };
}

export const TR_NETWORK_ADAPTER = {
  name: "tr-network",
  parse(source, filePath) {
    try {
      return parseMarkdown(source, filePath);
    } catch (error) {
      const lenient = lenientFrontmatter(source, filePath);
      if (!lenient) throw error;
      return lenient;
    }
  },
  async listFiles(vaultPath) {
    return markdownFiles(vaultPath);
  },
  accepts(vaultPath, absolutePath) {
    // Flat vault: only notes sitting directly in the vault root.
    return path.dirname(path.resolve(absolutePath)) === path.resolve(vaultPath);
  },
  normalize: trNormalize,
};

const ADAPTERS = new Map([
  ["default", DEFAULT_VAULT_ADAPTER],
  [TR_NETWORK_ADAPTER.name, TR_NETWORK_ADAPTER],
]);

export function resolveVaultAdapter(name) {
  if (name === undefined || name === null || name === "") return DEFAULT_VAULT_ADAPTER;
  const adapter = ADAPTERS.get(String(name).trim());
  if (!adapter) throw new Error(`bilinmeyen vault adapter: ${name}`);
  return adapter;
}
