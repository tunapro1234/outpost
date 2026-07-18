import { readFeedback, listMailDraftRecords } from "./drafts.mjs";
import { approvedMails } from "./store.mjs";
import { mailerUsers } from "./auth.mjs";
import { readUsage } from "./usage.mjs";

export async function userStats(workspace, options = {}) {
  const [users, drafts, outbox, feedback, usage] = await Promise.all([
    mailerUsers(options),
    listMailDraftRecords(workspace),
    approvedMails(workspace),
    readFeedback(workspace),
    readUsage(workspace),
  ]);
  const byUser = new Map(users.map((profile) => [profile.user, {
    ...profile,
    drafts: 0,
    approved: 0,
    rejected: 0,
    tokens: { in: 0, out: 0, estimated: false },
  }]));
  const draftIds = new Map(users.map((profile) => [profile.user, new Set()]));
  for (const draft of drafts) {
    const stat = byUser.get(draft.author);
    if (stat) draftIds.get(draft.author).add(draft.id);
  }
  // approvedMails: her satır zaten onaylanmış bir mail (DB tek kaynak).
  for (const record of outbox) {
    const stat = byUser.get(record.author);
    if (stat) {
      stat.approved += 1;
      draftIds.get(record.author).add(record.draft_id ?? record.id);
    }
  }
  for (const record of feedback) {
    const author = record.author ?? record.user;
    const stat = byUser.get(author);
    if (stat && record.kind !== "override-exclusion") {
      stat.rejected += 1;
      draftIds.get(author).add(record.draft_id ?? `${record.ts}:${record.person_id}`);
    }
  }
  for (const record of usage) {
    const stat = byUser.get(record.user);
    if (!stat) continue;
    stat.tokens.in += Number.isFinite(record.tokens_in) ? record.tokens_in : 0;
    stat.tokens.out += Number.isFinite(record.tokens_out) ? record.tokens_out : 0;
    if (record.estimated === true) stat.tokens.estimated = true;
  }
  for (const [user, ids] of draftIds) byUser.get(user).drafts = ids.size;
  return [...byUser.values()];
}
