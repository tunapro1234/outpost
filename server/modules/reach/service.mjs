import { workspaceMails } from "./mails.mjs";

export const DEFAULT_CANDIDATE_MIN_SCORE = 20;

const EMPTY_MAIL_VALUES = new Set(["", "-", "yok", "none", "null"]);

export function mailAddresses(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => typeof item === "string" ? item.split(/[;,\s]+/) : [])
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.includes("@") && !EMPTY_MAIL_VALUES.has(item));
}

export function hasMail(entity) {
  return mailAddresses(entity.meta.mail).length > 0;
}

export function reachCandidateEntities(index, mails, {
  minScore = DEFAULT_CANDIDATE_MIN_SCORE,
} = {}) {
  const contactedEntities = new Set();
  const contactedAddresses = new Set();
  for (const mail of mails) {
    if (mail.direction !== "out") continue;
    if (mail.entity_id) contactedEntities.add(mail.entity_id);
    if (mail.person_id) contactedEntities.add(mail.person_id);
    for (const address of mailAddresses(mail.to)) contactedAddresses.add(address);
  }

  return [...index.entities.values()].filter((entity) => {
    const addresses = mailAddresses(entity.meta.mail);
    return addresses.length > 0 &&
      typeof entity.meta.score === "number" &&
      entity.meta.score > minScore &&
      !contactedEntities.has(entity.id) &&
      !addresses.some((address) => contactedAddresses.has(address));
  });
}

export async function reachCandidates(workspace, options) {
  return reachCandidateEntities(
    workspace.index,
    await workspaceMails(workspace),
    options,
  );
}

export async function reachCandidateCount(workspace, options) {
  return (await reachCandidates(workspace, options)).length;
}
