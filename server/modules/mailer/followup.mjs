import { updateEntityMeta } from "../../lib/entity-meta.mjs";
import { workspaceMails } from "../reach/mails.mjs";
import { createMailDraftStage, listMailDraftRecords, readOutbox } from "./drafts.mjs";
import { loadSignals, resolveCompany, scorePerson } from "./service.mjs";
import { generateMailVariants } from "./writer.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

function time(value) {
  const result = new Date(value).getTime();
  return Number.isNaN(result) ? null : result;
}

export function unansweredOutbound(mails, personId) {
  const matched = mails
    .filter((mail) => mail.entity_id === personId && ["out", "in"].includes(mail.direction))
    .filter((mail) => time(mail.date) !== null)
    .sort((left, right) => time(left.date) - time(right.date));
  const outbound = [...matched].reverse().find((mail) => mail.direction === "out");
  if (!outbound) return null;
  if (matched.some((mail) => mail.direction === "in" && time(mail.date) > time(outbound.date))) {
    return null;
  }
  return outbound;
}

function sentFollowupStage(person, outbound) {
  if (Number.isInteger(outbound.followup_stage)) return Math.min(2, Math.max(0, outbound.followup_stage));
  if (Number.isFinite(person.meta.mails_sent)) return Math.min(2, Math.max(0, person.meta.mails_sent - 1));
  if (person.meta.mail_state === "followup_2") return 2;
  if (person.meta.mail_state === "followup_1") return 1;
  return 0;
}

export function followUpDecision({ person, outbound, now = new Date() }) {
  if (!outbound) return { action: "none" };
  const elapsedDays = (now.getTime() - time(outbound.date)) / DAY_MS;
  const sentStage = sentFollowupStage(person, outbound);
  if (sentStage >= 2) {
    return elapsedDays >= 5
      ? { action: "close", elapsedDays, sentStage }
      : { action: "none", elapsedDays, sentStage };
  }
  const threshold = sentStage === 0 ? 4 : 5;
  return elapsedDays >= threshold
    ? { action: "draft", stage: sentStage + 1, elapsedDays, sentStage }
    : { action: "none", elapsedDays, sentStage };
}

function followupContext(person, company, outbound, stage) {
  return JSON.stringify({
    person: person.meta,
    company: company?.meta ?? null,
    previous_mail: {
      subject: outbound.subject ?? outbound.summary ?? null,
      date: outbound.date,
    },
    followup_stage: stage,
  }, null, 2);
}

export async function generateFollowUpVariants(context, {
  workspace,
  agent = { model: "gpt-5.6-luna" },
  generate = generateMailVariants,
} = {}) {
  return generate(context, {
    workspace,
    agent,
    skillNames: ["follow-up.md", "tone-map.md", "subject-lines.md"],
    extraPrompt: "Bu bir follow-up'tır. Her subject kısa ve 'Re:' ile başlamalı. Gövde çok kısa olmalı. followup_stage=2 ise bunun son, nazik kapanış olduğunu belirt ve gövdede aynen ‘rahatsız ettiysek kusura bakmayın’ ifadesini kullan.",
  });
}

export async function runFollowUpEngine(workspace, {
  now = () => new Date(),
  mails: suppliedMails,
  generateVariants = generateFollowUpVariants,
} = {}) {
  const current = now();
  const [mails, pending, outbox, signals] = await Promise.all([
    suppliedMails ?? workspaceMails(workspace),
    listMailDraftRecords(workspace),
    readOutbox(workspace),
    loadSignals(workspace),
  ]);
  const pendingPeople = new Set([
    ...pending.map((draft) => draft.person_id),
    ...outbox.filter((record) => record.approved === true && record.sent === false)
      .map((record) => record.person_id ?? record.entity_id),
  ]);
  const result = { checked: 0, drafted: 0, closed: 0, drafts: [], warnings: [] };

  for (const person of workspace.index.entities.values()) {
    if (person.meta.type !== "person") continue;
    const outbound = unansweredOutbound(mails, person.id);
    if (!outbound) continue;
    result.checked += 1;
    if (pendingPeople.has(person.id)) continue;
    const decision = followUpDecision({ person, outbound, now: current });
    if (decision.action === "close") {
      await updateEntityMeta(workspace, person, { mail_state: "closed" });
      result.closed += 1;
      continue;
    }
    if (decision.action !== "draft") continue;
    const company = resolveCompany(person, workspace.index);
    const scored = scorePerson(person, workspace.index, signals);
    try {
      const variants = await generateVariants(
        followupContext(person, company, outbound, decision.stage),
        { workspace, agent: { model: "gpt-5.6-luna" } },
      );
      if (!variants.every((variant) => /^Re:/i.test(variant.subject))) {
        throw new Error("Follow-up subject alanı Re: ile başlamalı");
      }
      if (decision.stage === 2 && !variants.every((variant) =>
        /rahatsız ettiysek kusura bakmayın/iu.test(variant.body))) {
        throw new Error("İkinci follow-up nazik kapanış ifadesini içermeli");
      }
      const draft = await createMailDraftStage(workspace, {
        person,
        company,
        variants,
        score: scored.score,
        reasons: scored.reasons,
        followupStage: decision.stage,
        sourceAgent: "follow-up-engine",
        now,
      });
      await updateEntityMeta(workspace, person, { mail_state: `followup_${decision.stage}` });
      result.drafted += 1;
      result.drafts.push({ id: draft.id, person_id: person.id, followup_stage: decision.stage });
    } catch (error) {
      result.warnings.push(`${person.id}: ${error.message}`);
    }
  }
  return result;
}
