import test from "node:test";
import assert from "node:assert/strict";
import { timeToOpenMs, timeToReplyMs, reliabilityFlags, withReliability } from "../reliability.mjs";

const SENT = "2026-07-20T09:00:00.000Z";

function rec(over = {}) {
  return {
    sent_at: SENT,
    approved_at: SENT,
    tracking: { open_count: 0, proxy_open_count: 0, first_open: null, ...over.tracking },
    reply: { replied: false, ...over.reply },
  };
}

test("timeToOpenMs / timeToReplyMs measure from send", () => {
  const r = rec({ tracking: { first_open: "2026-07-20T10:00:00.000Z" }, reply: { replied: true, reply_at: "2026-07-20T12:00:00.000Z" } });
  assert.equal(timeToOpenMs(r), 3600_000);
  assert.equal(timeToReplyMs(r), 3 * 3600_000);
  assert.equal(timeToOpenMs(rec()), null);
});

test("replied_without_open: reply but no human open", () => {
  const r = rec({ reply: { replied: true, reply_at: "2026-07-20T12:00:00.000Z" } });
  const flags = reliabilityFlags(r, { now: () => new Date("2026-07-21T00:00:00Z") });
  assert.equal(flags.replied_without_open, true);
  assert.equal(flags.cold, false);
});

test("cold: matured with no engagement at all", () => {
  const fresh = reliabilityFlags(rec(), { now: () => new Date("2026-07-21T00:00:00Z"), coldAfterDays: 5 });
  assert.equal(fresh.cold, false, "not yet matured");
  const old = reliabilityFlags(rec(), { now: () => new Date("2026-07-27T00:00:00Z"), coldAfterDays: 5 });
  assert.equal(old.cold, true);
});

test("opened_no_reply: matured, opened, silent", () => {
  const r = rec({ tracking: { open_count: 2, first_open: "2026-07-20T10:00:00.000Z" } });
  const flags = reliabilityFlags(r, { now: () => new Date("2026-07-27T00:00:00Z"), coldAfterDays: 5 });
  assert.equal(flags.opened_no_reply, true);
  assert.equal(flags.cold, false);
});

test("withReliability attaches durations + flags", () => {
  const r = withReliability(rec({ reply: { replied: true, reply_at: "2026-07-20T11:00:00.000Z" } }), { now: () => new Date("2026-07-27T00:00:00Z") });
  assert.equal(r.durations.time_to_reply_ms, 2 * 3600_000);
  assert.equal(r.flags.replied_without_open, true);
});
