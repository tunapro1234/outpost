import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { parseMarkdown, serializeMarkdown, TYPE_DIRECTORIES } from "../../lib/vault.mjs";
import { slugify } from "../../lib/slug.mjs";
import { GATHER_KINDS } from "./registry.mjs";

const execFileAsync = promisify(execFile);
const VALID_GATHER_KINDS = new Set(GATHER_KINDS);
const CONTROL_FIELDS = new Set([
  "entity_id",
  "source_agent",
  "kind",
  "source_url",
  "gathered_at",
  "gather_summary",
]);

function stageRoot(workspace) {
  return path.join(workspace.directory, "stage");
}

function stageKind(value) {
  return VALID_GATHER_KINDS.has(value) ? value : "enrich";
}

function safeStageFile(file) {
  if (
    typeof file !== "string" ||
    path.basename(file) !== file ||
    !/^[a-z0-9][a-z0-9_.-]*\.md$/i.test(file)
  ) {
    const error = new Error("Geçersiz stage dosyası");
    error.statusCode = 400;
    throw error;
  }
  return file;
}

function proposedFields(meta) {
  return Object.fromEntries(
    Object.entries(meta).filter(([key, value]) =>
      !CONTROL_FIELDS.has(key) &&
      !["type", "name"].includes(key) &&
      value !== null &&
      value !== undefined &&
      value !== ""),
  );
}

function bodySummary(body) {
  return body
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

async function markdownFiles(directory) {
  try {
    return (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, "tr"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function listStage(workspace) {
  const directory = stageRoot(workspace);
  const proposals = [];
  for (const file of await markdownFiles(directory)) {
    const parsed = parseMarkdown(await fs.readFile(path.join(directory, file), "utf8"), file);
    proposals.push({
      file,
      kind: stageKind(parsed.meta.kind),
      source_agent: parsed.meta.source_agent ?? null,
      entity_hint: parsed.meta.entity_id ?? slugify(parsed.meta.name) ?? null,
      summary: parsed.meta.gather_summary ?? bodySummary(parsed.body),
      fields: proposedFields(parsed.meta),
    });
  }
  return proposals;
}

async function readDecisions(workspace) {
  const filePath = path.join(stageRoot(workspace), "decisions.jsonl");
  let source;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return source.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${filePath}:${index + 1}: geçersiz JSON: ${error.message}`);
    }
  });
}

export async function stageStats(workspace, kinds) {
  const counts = Object.fromEntries(kinds.map((kind) => [kind, { staged: 0, accepted: 0 }]));
  const stagedByAgent = new Map();
  for (const proposal of await listStage(workspace)) {
    const kind = counts[proposal.kind] ? proposal.kind : "enrich";
    counts[kind].staged += 1;
    if (proposal.source_agent) {
      stagedByAgent.set(
        proposal.source_agent,
        (stagedByAgent.get(proposal.source_agent) ?? 0) + 1,
      );
    }
  }
  for (const decision of await readDecisions(workspace)) {
    if (decision.decision !== "accept") continue;
    const kind = counts[decision.kind] ? decision.kind : "enrich";
    counts[kind].accepted += 1;
  }
  return { counts, stagedByAgent };
}

function stageTimestamp(iso) {
  return iso.replace(/[:.]/g, "-");
}

export async function writeStageProposal(workspace, {
  entity,
  agent,
  classification,
  sourceUrl,
  now = () => new Date(),
}) {
  const gatheredAt = now().toISOString();
  const unique = (values, key) => {
    const seen = new Set();
    return values.map((value) => value.trim()).filter((value) => {
      if (!value) return false;
      const normalized = key(value);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  };
  const emails = unique(classification.emails, (value) => value.toLowerCase());
  const phones = unique(classification.phones, (value) => value.replace(/\D/g, ""));
  const people = classification.people
    .filter((person) => person?.name?.trim())
    .map((person) => ({
      name: person.name.trim(),
      ...(person.role?.trim() ? { role: person.role.trim() } : {}),
    }));
  const fields = {
    ...(emails[0] ? { mail: emails[0] } : {}),
    ...(emails.length > 1 ? { other_mails: emails.slice(1) } : {}),
    ...(phones[0] ? { phone: phones[0] } : {}),
    ...(phones.length > 1 ? { other_phones: phones.slice(1) } : {}),
    ...(people.length ? { contacts: people } : {}),
  };
  if (!Object.keys(fields).length) return null;

  const meta = {
    type: entity.meta.type,
    name: entity.meta.name,
    entity_id: entity.id,
    source_agent: agent.id,
    kind: stageKind(agent.kind),
    source_url: sourceUrl,
    gathered_at: gatheredAt,
    gather_summary: classification.summary.trim(),
    ...fields,
  };
  const body = [
    `# ${entity.meta.name} — Gathering önerisi`,
    "",
    classification.summary.trim(),
    "",
    "## Kaynak",
    "",
    `- [İletişim taraması](${sourceUrl}) (${gatheredAt.slice(0, 10)})`,
    "",
  ].join("\n");
  const file = `${entity.id}--${stageTimestamp(gatheredAt)}.md`;
  const directory = stageRoot(workspace);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, file), serializeMarkdown(body, meta), {
    encoding: "utf8",
    flag: "wx",
  });
  return file;
}

async function defaultGitCommit(workspace, filePath, entityName) {
  const relative = path.relative(workspace.vaultPath, filePath);
  await execFileAsync("git", ["-C", workspace.vaultPath, "rev-parse", "--is-inside-work-tree"]);
  await execFileAsync("git", ["-C", workspace.vaultPath, "add", "--", relative]);
  try {
    await execFileAsync(
      "git",
      ["-C", workspace.vaultPath, "commit", "-m", `gather: ${entityName}`, "--", relative],
      { timeout: 30_000 },
    );
  } catch (error) {
    await execFileAsync(
      "git",
      ["-C", workspace.vaultPath, "restore", "--staged", "--", relative],
    ).catch(() => {});
    throw error;
  }
}

async function appendDecision(workspace, record) {
  const directory = stageRoot(workspace);
  await fs.mkdir(directory, { recursive: true });
  await fs.appendFile(
    path.join(directory, "decisions.jsonl"),
    `${JSON.stringify(record)}\n`,
    "utf8",
  );
}

async function uniqueTrashPath(workspace, file) {
  const directory = path.join(workspace.directory, ".stage-trash");
  await fs.mkdir(directory, { recursive: true });
  const extension = path.extname(file);
  const base = path.basename(file, extension);
  let target = path.join(directory, file);
  let suffix = 2;
  while (true) {
    try {
      await fs.access(target);
      target = path.join(directory, `${base}-${suffix}${extension}`);
      suffix += 1;
    } catch (error) {
      if (error.code === "ENOENT") return target;
      throw error;
    }
  }
}

function acceptedMeta(meta) {
  return Object.fromEntries(
    Object.entries(meta).filter(([key]) => !CONTROL_FIELDS.has(key)),
  );
}

function mergedBody(current, proposal) {
  const addition = proposal.trim();
  if (!addition) return current;
  return `${current.trimEnd()}\n\n## Gathering kabulü\n\n${addition}\n`;
}

export async function decideStage(workspace, {
  file,
  decision,
  note = null,
}, {
  commit = defaultGitCommit,
  now = () => new Date(),
} = {}) {
  safeStageFile(file);
  if (!["accept", "reject"].includes(decision)) {
    const error = new Error("decision accept veya reject olmalı");
    error.statusCode = 400;
    throw error;
  }
  if (note !== null && typeof note !== "string") {
    const error = new Error("note metin olmalı");
    error.statusCode = 400;
    throw error;
  }

  const sourcePath = path.join(stageRoot(workspace), file);
  let source;
  try {
    source = await fs.readFile(sourcePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      error.statusCode = 404;
      error.message = "Stage önerisi bulunamadı";
    }
    throw error;
  }
  const proposal = parseMarkdown(source, sourcePath);
  const record = {
    file,
    decision,
    note: note?.trim() || null,
    entity_id: proposal.meta.entity_id ?? null,
    source_agent: proposal.meta.source_agent ?? null,
    kind: stageKind(proposal.meta.kind),
    decided_at: now().toISOString(),
  };

  if (decision === "reject") {
    await appendDecision(workspace, record);
    await fs.rename(sourcePath, await uniqueTrashPath(workspace, file));
    return { ok: true, decision, entity_id: record.entity_id };
  }

  const index = workspace.index;
  const existing =
    (proposal.meta.entity_id && index.entities.get(proposal.meta.entity_id)) ||
    [...index.entities.values()].find((entity) =>
      slugify(entity.meta.name) === slugify(proposal.meta.name));
  const meta = acceptedMeta(proposal.meta);
  if (!TYPE_DIRECTORIES[meta.type] || typeof meta.name !== "string" || !meta.name.trim()) {
    const error = new Error("Stage önerisinde geçerli type ve name zorunlu");
    error.statusCode = 400;
    throw error;
  }

  const id = existing?.id ?? index.nextId(meta.name);
  const filePath = existing?.filePath ??
    path.join(index.vaultPath, TYPE_DIRECTORIES[meta.type], `${id}.md`);
  const previous = existing ? await fs.readFile(filePath, "utf8") : null;
  const nextMeta = existing ? { ...existing.meta, ...meta } : meta;
  const nextBody = existing ? mergedBody(existing.body, proposal.body) : proposal.body;

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, serializeMarkdown(nextBody, nextMeta), "utf8");
  try {
    await commit(workspace, filePath, nextMeta.name);
  } catch (error) {
    if (previous === null) {
      await fs.unlink(filePath).catch(() => {});
      index.removeFile(filePath);
    } else {
      await fs.writeFile(filePath, previous, "utf8");
      await index.loadFile(filePath);
    }
    throw error;
  }

  await index.loadFile(filePath);
  await appendDecision(workspace, { ...record, entity_id: id });
  await fs.unlink(sourcePath);
  return { ok: true, decision, entity_id: id };
}
