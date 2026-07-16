import test from "node:test";
import assert from "node:assert/strict";
import { reachStats } from "../mails.mjs";

test("Reach KPI'ları yalnız entity eşleşmeli outreach trafiğini sayar", () => {
  const mails = [
    { direction: "out", entity_id: "alice" },
    { direction: "out", entity_id: "alice" },
    { direction: "in", entity_id: "alice" },
    { direction: "out", entity_id: null },
    { direction: "in", entity_id: null },
    { direction: "in", entity_id: "" },
  ];

  assert.deepEqual(reachStats(mails), {
    sent: 2,
    replied: 1,
    replyRate: 50,
    pendingFollowUp: 0,
  });
});

test("Reach KPI'ları eşleşmiş gönderim yokken güvenli sıfır döner", () => {
  assert.deepEqual(reachStats([
    { direction: "out", entity_id: null },
    { direction: "in", entity_id: null },
  ]), {
    sent: 0,
    replied: 0,
    replyRate: 0,
    pendingFollowUp: 0,
  });
});
