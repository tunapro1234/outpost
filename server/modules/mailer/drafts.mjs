import { promises as fs } from "node:fs";
import path from "node:path";
import { parseMarkdown, serializeMarkdown } from "../../lib/vault.mjs";
import { updateEntityMeta } from "../../lib/entity-meta.mjs";
import { isDraftStale, readCalibration } from "./calibration.mjs";
import { newToken, extractLinks, trackingUrls } from "./tracking.mjs";
import { scheduleApprovedMail, sendLedgerTimes } from "./store.mjs";
import { nextSendTime, resolveTimezone } from "./schedule.mjs";
import { readMailSettings } from "./settings.mjs";

function stageDirectory(workspace) {
  return path.join(workspace.directory, "stage");
}

function outboxPath(workspace) {
  return workspace.mailsOutboxPath ?? path.join(workspace.directory, "mails", "outbox.jsonl");
}

function feedbackPath(workspace) {
  return path.join(workspace.directory, "mails", "feedback.jsonl");
}

function legacyExclusion(note) {
  if (typeof note !== "string" || !note.trim()) return {};
  const match = /^(\S+)\s+(\d{4}-\d{2}-\d{2}(?:T\S+)?)\s*:\s*(.*)$/u.exec(note.trim());
  if (!match) return { reason: note.trim() };
  return { by: match[1], at: match[2], reason: match[3] };
}

function safeId(id, message = "Geçersiz mail draft id") {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9_.-]*$/i.test(id)) {
    const error = new Error(message);
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
    author: typeof parsed.meta.author === "string" ? parsed.meta.author : null,
    followup_stage: parsed.meta.followup_stage ?? 0,
    generation: parsed.meta.generation ?? null,
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
  const records = await listMailDraftRecords(workspace);
  const calibrations = new Map(await Promise.all(
    [...new Set(records.map((draft) => draft.author).filter(Boolean))].map(async (author) => [
      author,
      (await readCalibration(workspace, author)).calibrated_at,
    ]),
  ));
  const drafts = records.map((draft) => {
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
      author: draft.author,
      stale: isDraftStale(draft, calibrations.get(draft.author)),
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
  author,
  generation = null,
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
    ...(author ? { author } : {}),
    followup_stage: followupStage,
    // Üretim provenance'ı (model/engine/prompt/context/skills/kalibrasyon/süre/token):
    // reply-rate'e göre optimize etmek için maildb'ye taşınır.
    ...(generation ? { generation } : {}),
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

export async function rewriteMailDraftStage(workspace, draft, {
  variants,
  author = draft.author,
  generation = null,
  now = () => new Date(),
} = {}) {
  if (!validVariants(variants)) throw new Error("Mail draft tam olarak 3 geçerli varyant içermeli");
  const filePath = path.join(stageDirectory(workspace), draft.file);
  const parsed = parseMarkdown(await fs.readFile(filePath, "utf8"), draft.file);
  if (parsed.meta.kind !== "mail-draft" || parsed.meta.status !== "pending") {
    throw new Error("Bekleyen mail draft yeniden yazılamadı");
  }
  const createdAt = now().toISOString();
  await fs.writeFile(filePath, serializeMarkdown(parsed.body, {
    ...parsed.meta,
    variants,
    created_at: createdAt,
    ...(author ? { author } : {}),
    ...(generation ? { generation } : {}),
  }), "utf8");
  return { id: draft.id, file: draft.file, created_at: createdAt };
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

async function appendJsonLines(filePath, records) {
  if (!records.length) return;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let prefix = "";
  try {
    const current = await fs.readFile(filePath);
    if (current.length && current[current.length - 1] !== 10) prefix = "\n";
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const lines = records.map((record) => JSON.stringify(record)).join("\n");
  await fs.appendFile(filePath, `${prefix}${lines}\n`, "utf8");
}

export async function readFeedback(workspace) {
  const filePath = feedbackPath(workspace);
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

export async function badContentNotes(workspace, personId, { limit = 3 } = {}) {
  return (await readFeedback(workspace))
    .filter((entry) => entry?.kind === "bad-content" && entry.person_id === personId &&
      typeof entry.text === "string" && entry.text.trim())
    .slice(-limit)
    .map((entry) => entry.text.trim());
}

export async function listExclusions(workspace) {
  return [...workspace.index.entities.values()]
    .filter((entity) => entity.meta.type === "company" && entity.meta.outreach === "excluded")
    .map((entity) => {
      const legacy = legacyExclusion(entity.meta.outreach_note);
      return {
        company_id: entity.id,
        name: entity.meta.name,
        by: entity.meta.outreach_by ?? legacy.by ?? null,
        at: entity.meta.outreach_at ?? legacy.at ?? null,
        reason: entity.meta.outreach_reason ?? legacy.reason ?? null,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "tr"));
}

export async function overrideExclusion(workspace, companyId, payload = {}, {
  now = () => new Date(),
  user = "unknown",
} = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const error = new Error("JSON gövdesi nesne olmalı");
    error.statusCode = 400;
    throw error;
  }
  if (payload.text !== undefined && typeof payload.text !== "string") {
    const error = new Error("text metin olmalı");
    error.statusCode = 400;
    throw error;
  }
  const company = workspace.index.entities.get(safeId(companyId, "Geçersiz company id"));
  if (!company || company.meta.type !== "company") {
    const error = new Error("Şirket entity bulunamadı");
    error.statusCode = 404;
    throw error;
  }
  const ts = now().toISOString();
  const text = payload.text?.trim() ?? "";
  await updateEntityMeta(workspace, company, {
    outreach: undefined,
    outreach_by: undefined,
    outreach_at: undefined,
    outreach_reason: undefined,
    outreach_note: undefined,
  });
  await appendJsonLines(feedbackPath(workspace), [{
    kind: "override-exclusion",
    user,
    ts,
    company_id: company.id,
    ...(text ? { text } : {}),
  }]);
  return { ok: true, company_id: company.id, status: "overridden" };
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
  const subject = payload.subject?.trim() || selected.subject;
  const body = payload.body?.trim() || selected.body;
  // İzleme token'ı onay anında verilir: gönderici (Brevo relay bağlanınca) pikseli
  // ve sarmalanan linkleri maile gömer, açılma/tıklama bu token altında toplanır.
  const token = newToken();
  const ws = workspace.id ?? "demo";
  const links = extractLinks(body);
  const urls = trackingUrls(ws, token, links.length);
  const record = {
    id: `outbox--${id}`,
    draft_id: id,
    entity_id: draft.person_id,
    person_id: draft.person_id,
    company_id: draft.company_id,
    variant: payload.variant,
    subject,
    body,
    rationale: selected.rationale,
    tone: selected.tone,
    followup_stage: draft.followup_stage,
    created_at: draft.created_at,
    ...(draft.author ? { author: draft.author } : {}),
    // Optimizasyon için: seçilen varyant + üretilen 3 varyantın tamamı + provenance.
    variant_tone: selected.tone,
    variants_all: draft.variants,
    ...(draft.generation ? { generation: draft.generation } : {}),
    approved_at: approvedAt,
    approved: true,
    sent: false,
    track_token: token,
    pixel_url: urls.pixel,
    click_urls: urls.clicks,
  };
  // Kanonik DB kaydı + akıllı schedule (ATOMİK + idempotent tek transaction).
  // Mail ANINDA gitmez: alıcının saat dilimine göre iyi bir saate (rolling)
  // schedule edilir; gönderim dispatcher'da, varsayılan dry-run. outbox.jsonl
  // ARTIK YAZILMAZ — SQLite tek kaynak (dual-write kaldırıldı).
  const person = workspace.index?.entities?.get(draft.person_id) ?? null;
  const toAddr = person?.meta?.mail
    ?? (Array.isArray(person?.meta?.mails) ? person.meta.mails[0] : null);
  const settings = await readMailSettings(workspace);
  const timezone = resolveTimezone(
    person?.meta?.city ?? person?.meta?.il ?? person?.meta?.sehir ?? null,
  );
  const taken = sendLedgerTimes(workspace)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  const slot = nextSendTime({
    afterUtc: now(),
    config: { ...settings.schedule, timezone, dailyMax: settings.daily_max_sends },
    takenUtc: taken,
    rngSeed: token,
  });
  const { send_id: sendId } = scheduleApprovedMail(workspace, {
    id: record.id,
    draft_id: id,
    person_id: draft.person_id,
    company_id: draft.company_id,
    to_addr: toAddr,
    subject,
    body,
    tone: selected.tone,
    variant: payload.variant,
    score: draft.score,
    followup_stage: draft.followup_stage,
    author: draft.author ?? null,
    rationale: selected.rationale,
    variants: draft.variants,
    reasons: draft.reasons,
    generation: draft.generation ?? null,
    links,
    track_token: token,
    created_at: draft.created_at,
    approved_at: approvedAt,
  }, {
    scheduled_at: slot.scheduledAtUtc.toISOString(),
    window_reason: slot.windowReason,
    dispatch_mode: settings.dispatch_mode,
  });

  await updateEntityMeta(workspace, draft.person_id, {
    mail_state: "approved",
    mail_scheduled_at: slot.scheduledAtUtc.toISOString(),
  });
  await archiveDraft(workspace, draft.file);
  return {
    ok: true,
    id,
    status: "approved",
    outbox: record,
    scheduled_at: slot.scheduledAtUtc.toISOString(),
    window_reason: slot.windowReason,
    dispatch_mode: settings.dispatch_mode,
    send_id: sendId,
  };
}

const REJECT_KINDS = new Set([
  "exclude-company",
  "know-person",
  "wrong-person",
  "bad-content",
  "other",
]);

function rejectDecision(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const error = new Error("JSON gövdesi nesne olmalı");
    error.statusCode = 400;
    throw error;
  }
  if (payload.kind !== undefined && !REJECT_KINDS.has(payload.kind)) {
    const error = new Error("kind geçerli bir reject türü olmalı");
    error.statusCode = 400;
    throw error;
  }
  for (const field of ["text", "reason"]) {
    if (payload[field] !== undefined && typeof payload[field] !== "string") {
      const error = new Error(`${field} metin olmalı`);
      error.statusCode = 400;
      throw error;
    }
  }
  return {
    kind: payload.kind ?? "other",
    text: (payload.text ?? payload.reason ?? "").trim(),
  };
}

function decisionNote(user, timestamp, text) {
  return `${user} ${timestamp.slice(0, 10)}: ${text}`.trimEnd();
}

function entitySummary(entity, id) {
  return { id, name: entity?.meta.name ?? id };
}

export async function rejectMailDraft(workspace, id, payload = {}, {
  now = () => new Date(),
  user = "unknown",
} = {}) {
  const decision = rejectDecision(payload);
  const draft = await findDraft(workspace, id);
  const rejectedAt = now().toISOString();
  const note = decisionNote(user, rejectedAt, decision.text);
  const person = workspace.index.entities.get(draft.person_id);
  const company = draft.company_id ? workspace.index.entities.get(draft.company_id) : null;
  let drafts = [draft];

  if (decision.kind === "exclude-company") {
    if (!draft.company_id || !company) {
      const error = new Error("Taslağa bağlı şirket entity bulunamadı");
      error.statusCode = 400;
      throw error;
    }
    drafts = [
      draft,
      ...(await listMailDraftRecords(workspace)).filter((candidate) =>
        candidate.id !== draft.id && candidate.company_id === draft.company_id),
    ];
    await updateEntityMeta(workspace, company, {
      outreach: "excluded",
      outreach_by: user,
      outreach_at: rejectedAt,
      outreach_reason: decision.text,
      outreach_note: undefined,
    });
  }

  if (decision.kind === "know-person") {
    await updateEntityMeta(workspace, person, { mail_state: "closed", mail_note: note });
  } else if (decision.kind === "wrong-person") {
    await updateEntityMeta(workspace, person, { mail_state: "closed" });
  } else {
    for (const personId of new Set(drafts.map((candidate) => candidate.person_id))) {
      await updateEntityMeta(workspace, personId, { mail_state: "none" });
    }
  }

  for (const rejected of drafts) await archiveDraft(workspace, rejected.file);
  await appendJsonLines(feedbackPath(workspace), drafts.map((rejected, index) => ({
    ts: rejectedAt,
    user,
    draft_id: rejected.id,
    person_id: rejected.person_id,
    company_id: rejected.company_id,
    kind: decision.kind,
    text: decision.text,
    ...(rejected.author ? { author: rejected.author } : {}),
    ...(index > 0 ? { cascade: true } : {}),
  })));

  return {
    ok: true,
    id,
    status: "rejected",
    rejected: drafts.map((rejected) => rejected.id),
    ...(decision.kind === "exclude-company"
      ? { company_excluded: entitySummary(company, draft.company_id) }
      : {}),
    ...(["know-person", "wrong-person"].includes(decision.kind)
      ? { person_closed: entitySummary(person, draft.person_id) }
      : {}),
  };
}
