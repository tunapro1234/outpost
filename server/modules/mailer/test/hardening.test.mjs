// Hardening tests for the SQLite send pipeline: atomic claim (no double-send),
// crash recovery (resetStuckSends), idempotent scheduling, and approvedMails
// deriving real send status. Mirrors the fakeWorkspace/temporaryDirectory
// patterns used by store.test.mjs / dispatch.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { temporaryDirectory } from "../../../test-support/helpers.mjs";
import { closeWorkspaceDb } from "../../../lib/db.mjs";
import {
  insertMail,
  scheduleSend,
  claimDueSends,
  resetStuckSends,
  scheduleApprovedMail,
  approvedMails,
  sendsByMail,
  mailById,
  markSend,
} from "../store.mjs";
import { dispatchDueSends } from "../dispatch.mjs";

function fakeWorkspace(directory) {
  return { id: "probot", directory, index: { entities: new Map() } };
}

async function freshWorkspace(t) {
  const directory = await temporaryDirectory("outpost-hardening-");
  const workspace = fakeWorkspace(directory);
  t.after(() => {
    closeWorkspaceDb(workspace);
    return fs.rm(directory, { recursive: true, force: true });
  });
  return workspace;
}

const NOW = "2026-07-20T12:00:00.000Z";

test("claimDueSends atomically flips due sends to sending; a second claim gets none", async (t) => {
  const workspace = await freshWorkspace(t);
  const a = scheduleSend(workspace, { mail_id: "m1", scheduled_at: "2026-07-20T09:00:00.000Z" });
  const b = scheduleSend(workspace, { mail_id: "m2", scheduled_at: "2026-07-20T10:00:00.000Z" });
  // Future-dated: must NOT be claimed.
  scheduleSend(workspace, { mail_id: "m3", scheduled_at: "2026-07-25T09:00:00.000Z" });

  const first = claimDueSends(workspace, NOW);
  assert.equal(first.length, 2, "both due sends claimed at once");
  assert.deepEqual(first.map((s) => s.id).sort((x, y) => x - y), [a, b].sort((x, y) => x - y));
  assert.ok(first.every((s) => s.status === "sending"), "claimed rows come back as sending");

  const second = claimDueSends(workspace, NOW);
  assert.equal(second.length, 0, "immediate second claim returns none of the same rows");

  // Future send is still scheduled and untouched.
  const all = [...sendsByMail(workspace, "m1"), ...sendsByMail(workspace, "m2"), ...sendsByMail(workspace, "m3")];
  const future = all.find((s) => s.mail_id === "m3");
  assert.equal(future.status, "scheduled", "future-dated send never claimed");
});

test("claimDueSends never re-claims canceled or failed sends", async (t) => {
  const workspace = await freshWorkspace(t);
  const canceled = scheduleSend(workspace, { mail_id: "m1", scheduled_at: "2026-07-20T09:00:00.000Z" });
  const failed = scheduleSend(workspace, { mail_id: "m2", scheduled_at: "2026-07-20T09:00:00.000Z" });
  markSend(workspace, canceled, { status: "canceled", error: "reply-received" });
  markSend(workspace, failed, { status: "failed", error: "boom" });

  assert.equal(claimDueSends(workspace, NOW).length, 0, "only 'scheduled' sends are claimable");
});

test("resetStuckSends flips leftover sending back to scheduled and returns the count", async (t) => {
  const workspace = await freshWorkspace(t);
  scheduleSend(workspace, { mail_id: "m1", scheduled_at: "2026-07-20T09:00:00.000Z" });
  scheduleSend(workspace, { mail_id: "m2", scheduled_at: "2026-07-20T10:00:00.000Z" });

  const claimed = claimDueSends(workspace, NOW);
  assert.equal(claimed.length, 2);

  const reset = resetStuckSends(workspace);
  assert.equal(reset, 2, "both stuck 'sending' rows reset");
  // A no-op second call: nothing left in 'sending'.
  assert.equal(resetStuckSends(workspace), 0);

  // After recovery they are claimable again.
  assert.equal(claimDueSends(workspace, NOW).length, 2, "recovered sends re-claimable");
});

test("scheduleApprovedMail is idempotent: two calls, one mail and exactly one send", async (t) => {
  const workspace = await freshWorkspace(t);
  const mailRow = {
    id: "outbox--m1", person_id: "p1", to_addr: "ada@x.co",
    subject: "Hi", body: "Body", track_token: "tok1",
    created_at: "2026-07-20T08:00:00.000Z", approved_at: "2026-07-20T08:00:00.000Z",
  };
  const sendParams = { scheduled_at: "2026-07-20T09:00:00.000Z", dispatch_mode: "dry_run" };

  const first = scheduleApprovedMail(workspace, mailRow, sendParams);
  assert.equal(first.already_scheduled, false);

  const second = scheduleApprovedMail(workspace, mailRow, sendParams);
  assert.equal(second.already_scheduled, true, "second call reports already scheduled");
  assert.equal(second.send_id, first.send_id, "same send id returned, no new send");

  assert.ok(mailById(workspace, "outbox--m1"), "mail exists");
  const sends = sendsByMail(workspace, "outbox--m1");
  assert.equal(sends.length, 1, "exactly one mail_send after two calls");
  assert.equal(sends[0].status, "scheduled");
});

test("approvedMails derives pending/sent from the latest send status", async (t) => {
  const workspace = await freshWorkspace(t);
  const { send_id } = scheduleApprovedMail(
    workspace,
    { id: "outbox--m1", person_id: "p1", to_addr: "ada@x.co", subject: "Hi", body: "b", approved_at: "2026-07-20T08:00:00.000Z" },
    { scheduled_at: "2026-07-20T09:00:00.000Z", dispatch_mode: "dry_run" },
  );

  let [row] = approvedMails(workspace);
  assert.equal(row.id, "outbox--m1");
  assert.equal(row.pending, true, "scheduled → pending");
  assert.equal(row.sent, false, "scheduled → not sent");
  assert.equal(row.send_status, "scheduled");

  markSend(workspace, send_id, { status: "sent_dryrun", sent_at: "2026-07-20T09:05:00.000Z" });

  [row] = approvedMails(workspace);
  assert.equal(row.pending, false, "sent_dryrun → not pending (inflight cleared)");
  assert.equal(row.sent, true, "sent_dryrun counts as sent");
  assert.equal(row.sent_at, "2026-07-20T09:05:00.000Z");
});

test("no double dispatch: a second dispatchDueSends over the same due set processes zero", async (t) => {
  const workspace = await freshWorkspace(t);
  insertMail(workspace, {
    id: "outbox--m1", person_id: "p1", to_addr: "ali@x.com",
    subject: "Merhaba", body: "Selam", track_token: "aaaabbbbccccdddd",
    approved_at: "2026-07-20T08:00:00.000Z",
  });
  scheduleSend(workspace, { mail_id: "outbox--m1", scheduled_at: "2026-07-20T09:30:00.000Z" });

  const opts = { now: () => new Date("2026-07-20T10:00:00.000Z") };
  const first = await dispatchDueSends(workspace, opts);
  assert.equal(first.processed, 1);
  assert.equal(first.dry_run, 1);

  const second = await dispatchDueSends(workspace, opts);
  assert.equal(second.processed, 0, "claim removed the send from 'scheduled' → no reprocessing");

  const sends = sendsByMail(workspace, "outbox--m1");
  assert.equal(sends.length, 1);
  assert.equal(sends[0].status, "sent_dryrun", "processed exactly once");
});
