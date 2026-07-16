import { promises as fs } from "node:fs";
import path from "node:path";
import { parseMarkdown, serializeMarkdown } from "../../lib/vault.mjs";
import { updateEntityMeta } from "../../lib/entity-meta.mjs";

function stageDirectory(workspace) {
  return path.join(workspace.directory, "stage");
}

function outboxPath(workspace) {
  return workspace.mailsOutboxPath ?? path.join(workspace.directory, "mails", "outbox.jsonl");
}

function safeId(id) {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9_.-]*$/i.test(id)) {
    const error = new Error("Geçersiz mail draft id");
    error.statusCode = 400;
    throw error;
  }
  return id;
}

async function stageFiles(workspace) {
  try {
    return (await fs.readdir(stageDirectory(workspace), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function validVariants(value) {
  return Array.isArray(value) && value.length === 3 && value.every((variant) =>
    variant && typeof variant === "object" &&
    ["subject", "body", "rationale", "tone"].every((key) => typeof variant[key] === "string"));
}

function draftRecord(file, parsed) {
  if (parsed.meta.kind !== "mail-draft" || parsed.meta.status !== "pending") return null;
  if (!validVariants(parsed.meta.variants)) return null;
  return {
    id: path.basename(file, ".md"),
    file,
    person_id: parsed.meta.person_id,
    company_id: parsed.meta.company_id ?? null,
    score: parsed.meta.queue_score ?? 0,
    reasons: Array.isArray(parsed.meta.reasons) ? parsed.meta.reasons : [],
    variants: parsed.meta.variants,
    created_at: parsed.meta.created_at,
    followup_stage: parsed.meta.followup_stage ?? 0,
    status: "pending",
  };
}

export async function listMailDraftRecords(workspace) {
  const records = [];
  for (const file of await stageFiles(workspace)) {
    const parsed = parseMarkdown(
      await fs.readFile(path.join(stageDirectory(workspace), file), "utf8"),
      file,
    );
    const record = draftRecord(file, parsed);
    if (record) records.push(record);
  }
  return records.sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
}

export async function listMailDrafts(workspace) {
  const drafts = (await listMailDraftRecords(workspace)).map((draft) => {
    const person = workspace.index.entities.get(draft.person_id);
    const company = draft.company_id ? workspace.index.entities.get(draft.company_id) : null;
    return {
      id: draft.id,
      person: { id: draft.person_id, name: person?.meta.name ?? draft.person_id },
      company: draft.company_id
        ? { id: draft.company_id, name: company?.meta.name ?? draft.company_id }
        : { id: null, name: null },
      score: draft.score,
      reasons: draft.reasons,
      variants: draft.variants,
      created_at: draft.created_at,
      followup_stage: draft.followup_stage,
      status: "pending",
    };
  });
  return { drafts };
}

function timestamp(value) {
  return value.replace(/[:.]/g, "-");
}

export async function createMailDraftStage(workspace, {
  person,
  company,
  variants,
  score,
  reasons,
  followupStage = 0,
  sourceAgent = "mail-writer",
  now = () => new Date(),
}) {
  if (!validVariants(variants)) throw new Error("Mail draft tam olarak 3 geçerli varyant içermeli");
  const createdAt = now().toISOString();
  const id = `mail-draft--${person.id}--f${followupStage}--${timestamp(createdAt)}`;
  const meta = {
    kind: "mail-draft",
    source_agent: sourceAgent,
    person_id: person.id,
    company_id: company?.id ?? null,
    variants,
    queue_score: score,
    reasons,
    created_at: createdAt,
    followup_stage: followupStage,
    status: "pending",
  };
  const body = `# ${person.meta.name} — Mail taslağı\n\nBu kayıt yalnız onay kuyruğudur; gönderim yapmaz.\n`;
  const directory = stageDirectory(workspace);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${id}.md`), serializeMarkdown(body, meta), {
    encoding: "utf8",
    flag: "wx",
  });
  return { id, file: `${id}.md`, created_at: createdAt };
}

export async function readOutbox(workspace) {
  let source;
  const filePath = outboxPath(workspace);
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

async function appendOutbox(workspace, record) {
  const filePath = outboxPath(workspace);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let prefix = "";
  try {
    const current = await fs.readFile(filePath);
    if (current.length && current[current.length - 1] !== 10) prefix = "\n";
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.appendFile(filePath, `${prefix}${JSON.stringify(record)}\n`, "utf8");
}

async function archiveDraft(workspace, file) {
  const source = path.join(stageDirectory(workspace), file);
  const directory = path.join(workspace.directory, ".stage-trash");
  await fs.mkdir(directory, { recursive: true });
  let target = path.join(directory, file);
  for (let suffix = 2; ; suffix += 1) {
    try {
      await fs.access(target);
      target = path.join(directory, `${path.basename(file, ".md")}-${suffix}.md`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await fs.rename(source, target);
      return;
    }
  }
}

async function findDraft(workspace, id) {
  safeId(id);
  const file = `${id}.md`;
  let parsed;
  try {
    parsed = parseMarkdown(await fs.readFile(path.join(stageDirectory(workspace), file), "utf8"), file);
  } catch (error) {
    if (error.code === "ENOENT") {
      error.statusCode = 404;
      error.message = "Mail draft bulunamadı";
    }
    throw error;
  }
  const record = draftRecord(file, parsed);
  if (!record) {
    const error = new Error("Bekleyen mail draft bulunamadı");
    error.statusCode = 404;
    throw error;
  }
  return record;
}

export async function approveMailDraft(workspace, id, payload, { now = () => new Date() } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const error = new Error("JSON gövdesi nesne olmalı");
    error.statusCode = 400;
    throw error;
  }
  const draft = await findDraft(workspace, id);
  if (!Number.isInteger(payload.variant) || payload.variant < 0 || payload.variant >= draft.variants.length) {
    const error = new Error("variant 0-2 arasında bir tamsayı olmalı");
    error.statusCode = 400;
    throw error;
  }
  for (const key of ["subject", "body"]) {
    if (payload[key] !== undefined && (typeof payload[key] !== "string" || !payload[key].trim())) {
      const error = new Error(`${key} boş olmayan metin olmalı`);
      error.statusCode = 400;
      throw error;
    }
  }
  const selected = draft.variants[payload.variant];
  const approvedAt = now().toISOString();
  const record = {
    id: `outbox--${id}`,
    draft_id: id,
    entity_id: draft.person_id,
    person_id: draft.person_id,
    company_id: draft.company_id,
    variant: payload.variant,
    subject: payload.subject?.trim() || selected.subject,
    body: payload.body?.trim() || selected.body,
    rationale: selected.rationale,
    tone: selected.tone,
    followup_stage: draft.followup_stage,
    created_at: draft.created_at,
    approved_at: approvedAt,
    approved: true,
    sent: false,
  };
  await appendOutbox(workspace, record);
  await updateEntityMeta(workspace, draft.person_id, { mail_state: "approved" });
  await archiveDraft(workspace, draft.file);
  return { ok: true, id, status: "approved", outbox: record };
}

export async function rejectMailDraft(workspace, id, payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
    (payload.reason !== undefined && typeof payload.reason !== "string")) {
    const error = new Error("reason metin olmalı");
    error.statusCode = 400;
    throw error;
  }
  const draft = await findDraft(workspace, id);
  await updateEntityMeta(workspace, draft.person_id, { mail_state: "none" });
  await archiveDraft(workspace, draft.file);
  return { ok: true, id, status: "rejected" };
}
