// server/modules/mailer/test/schedule.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SCHEDULE,
  mergeSchedule,
  resolveTimezone,
  nextSendTime,
  followupDueTime,
  localPartsFromUtc,
  utcFromLocalWallClock,
} from "../schedule.mjs";

const TZ = "Europe/Istanbul";

// Helpers ------------------------------------------------------------

function local(dateUtc, tz = TZ) {
  return localPartsFromUtc(dateUtc, tz);
}

// Is the local minute-of-day inside one of the config windows?
function inSomeWindow(parts, cfg = DEFAULT_SCHEDULE) {
  const m = parts.hour * 60 + parts.minute;
  return cfg.windows.some((w) => m >= w.startMin && m < w.endMin);
}

// Recompute rolling constraint from scratch over a set of ms timestamps.
function maxRollingCount(timestamps) {
  const HOUR = 3600000;
  const all = [...timestamps].sort((a, b) => a - b);
  let max = 0;
  for (const start of all) {
    let c = 0;
    for (const x of all) if (x >= start && x < start + HOUR) c++;
    if (c > max) max = c;
  }
  return max;
}

// --------------------------------------------------------------------

test("Intl helpers round-trip local wall-clock <-> UTC", () => {
  const wall = { year: 2026, month: 7, day: 21, hour: 9, minute: 47 };
  const asUtc = utcFromLocalWallClock(wall, TZ);
  const back = local(asUtc);
  assert.equal(back.year, 2026);
  assert.equal(back.month, 7);
  assert.equal(back.day, 21);
  assert.equal(back.hour, 9);
  assert.equal(back.minute, 47);
  // Istanbul is UTC+3, so 09:47 local == 06:47 UTC.
  assert.equal(asUtc.toISOString(), "2026-07-21T06:47:00.000Z");
});

test("mergeSchedule validates, clamps, and ignores garbage", () => {
  const cfg = mergeSchedule({
    jitterMin: 999, // clamp to 600
    rollingPerHour: 0, // clamp to 1
    minGapMin: -5, // clamp to 0
    weekdays: [1, 9, "x", 5], // keep 1 and 5
    windows: [{ startMin: 100, endMin: 50 }], // invalid -> fall back to default windows
    timezone: 42, // invalid -> default
  });
  assert.equal(cfg.jitterMin, 600);
  assert.equal(cfg.rollingPerHour, 1);
  assert.equal(cfg.minGapMin, 0);
  assert.deepEqual(cfg.weekdays, [1, 5]);
  assert.deepEqual(cfg.windows, DEFAULT_SCHEDULE.windows);
  assert.equal(cfg.timezone, "Europe/Istanbul");

  // empty overrides == default
  assert.deepEqual(mergeSchedule(), DEFAULT_SCHEDULE);
});

test("resolveTimezone defaults to Istanbul, recognises a few cities", () => {
  assert.equal(resolveTimezone(undefined), "Europe/Istanbul");
  assert.equal(resolveTimezone("Ankara"), "Europe/Istanbul");
  assert.equal(resolveTimezone("London"), "Europe/London");
  assert.equal(resolveTimezone({ city: "Berlin" }), "Europe/Berlin");
  assert.equal(resolveTimezone({ istanbul: true, city: "London" }), "Europe/Istanbul");
  assert.equal(resolveTimezone({ known: "America/New_York" }), "America/New_York");
});

test("nextSendTime lands on an allowed weekday inside a window", () => {
  // 2026-07-20 is a Monday (not allowed). afterUtc 06:00Z == 09:00 local Mon.
  const afterUtc = new Date("2026-07-20T06:00:00Z");
  const { scheduledAtUtc, windowReason } = nextSendTime({
    afterUtc,
    config: DEFAULT_SCHEDULE,
    rngSeed: "mail-1",
  });
  const p = local(scheduledAtUtc);
  assert.ok(DEFAULT_SCHEDULE.weekdays.includes(p.weekday), `weekday ${p.weekday} allowed`);
  assert.ok(inSomeWindow(p), `${p.hour}:${p.minute} inside a window`);
  assert.ok(scheduledAtUtc.getTime() >= afterUtc.getTime());
  assert.match(windowReason, /Europe\/Istanbul/);
});

test("Monday afterUtc rolls forward to the next allowed weekday (Tue)", () => {
  const afterUtc = new Date("2026-07-20T06:00:00Z"); // Monday
  const { scheduledAtUtc } = nextSendTime({ afterUtc, config: DEFAULT_SCHEDULE, rngSeed: "x" });
  const p = local(scheduledAtUtc);
  assert.equal(p.weekday, 2); // Tuesday
  assert.equal(p.day, 21);
});

test("Friday/weekend afterUtc rolls to the next allowed weekday", () => {
  const friday = new Date("2026-07-24T06:00:00Z"); // Fri 09:00 local
  const { scheduledAtUtc } = nextSendTime({ afterUtc: friday, config: DEFAULT_SCHEDULE, rngSeed: "y" });
  const p = local(scheduledAtUtc);
  assert.ok([2, 3, 4].includes(p.weekday));
  // Next allowed weekday after Fri 07-24 is Tue 07-28.
  assert.equal(p.day, 28);
  assert.equal(p.weekday, 2);
});

test("different rngSeed produces different jittered minutes", () => {
  const afterUtc = new Date("2026-07-20T06:00:00Z");
  const minutes = new Set();
  for (const seed of ["a", "b", "c", "d", "e", "seed-42"]) {
    const { scheduledAtUtc } = nextSendTime({ afterUtc, config: DEFAULT_SCHEDULE, rngSeed: seed });
    const p = local(scheduledAtUtc);
    minutes.add(p.hour * 60 + p.minute);
  }
  assert.ok(minutes.size > 1, `expected varied minutes, got ${[...minutes]}`);
});

test("rolling limit pushes the (rollingPerHour+1)th mail out of a saturated hour", () => {
  const cfg = DEFAULT_SCHEDULE;
  const afterUtc = new Date("2026-07-20T06:00:00Z");
  // Saturate the Tue morning window: 12 sends spaced by minGap (4 min),
  // starting 09:30 local -> 09:30..10:14, all inside a 60-min window.
  const taken = [];
  for (let i = 0; i < cfg.rollingPerHour; i++) {
    taken.push(utcFromLocalWallClock({ year: 2026, month: 7, day: 21, hour: 9, minute: 30 + i * cfg.minGapMin }, TZ));
  }
  const { scheduledAtUtc } = nextSendTime({ afterUtc, config: cfg, takenUtc: taken, rngSeed: "overflow" });

  // Adding the new slot must not create any 60-min window with > rollingPerHour.
  const all = taken.map((d) => d.getTime()).concat(scheduledAtUtc.getTime());
  assert.ok(maxRollingCount(all) <= cfg.rollingPerHour, "rolling limit respected");
  // And it must land later than the last saturated send.
  const lastTaken = Math.max(...taken.map((d) => d.getTime()));
  assert.ok(scheduledAtUtc.getTime() > lastTaken);
});

test("minGap is respected against taken times", () => {
  const cfg = DEFAULT_SCHEDULE;
  const afterUtc = new Date("2026-07-20T06:00:00Z");
  const taken = [utcFromLocalWallClock({ year: 2026, month: 7, day: 21, hour: 9, minute: 40 }, TZ)];
  const { scheduledAtUtc } = nextSendTime({ afterUtc, config: cfg, takenUtc: taken, rngSeed: "gap" });
  const diffMin = Math.abs(scheduledAtUtc.getTime() - taken[0].getTime()) / 60000;
  assert.ok(diffMin >= cfg.minGapMin, `gap ${diffMin} >= ${cfg.minGapMin}`);
});

test("followupDueTime is >= gapDays later and in a valid window", () => {
  const afterUtc = new Date("2026-07-21T07:00:00Z"); // Tue
  const gapDays = 3;
  const { scheduledAtUtc, windowReason } = followupDueTime({
    afterUtc,
    gapDays,
    config: DEFAULT_SCHEDULE,
    rngSeed: "fu",
  });
  const minDelta = gapDays * 24 * 3600000;
  assert.ok(scheduledAtUtc.getTime() - afterUtc.getTime() >= minDelta, "at least gapDays later");
  const p = local(scheduledAtUtc);
  assert.ok(DEFAULT_SCHEDULE.weekdays.includes(p.weekday));
  assert.ok(inSomeWindow(p));
  assert.match(windowReason, /(sabah|öğleden sonra) penceresi/);
});

test("zorunlu jitter: sonuc asla yuvarlak dakikaya (5in kati) dusmez", () => {
  const after = new Date("2026-07-20T06:00:00Z");
  for (let i = 0; i < 40; i++) {
    const { scheduledAtUtc } = nextSendTime({ afterUtc: after, config: DEFAULT_SCHEDULE, rngSeed: `mail-${i}` });
    const local = localPartsFromUtc(scheduledAtUtc, TZ);
    assert.notEqual(local.minute % 5, 0, `seed mail-${i}: ${local.hour}:${local.minute}`);
  }
});

test("dailyMax: gunluk tavan dolunca mail ertesi uygun gune kayar", () => {
  const after = new Date("2026-07-20T06:00:00Z"); // Mon -> Tue
  const cfg = { ...DEFAULT_SCHEDULE, dailyMax: 2 };
  const taken = [];
  const days = new Set();
  for (let i = 0; i < 6; i++) {
    const { scheduledAtUtc } = nextSendTime({ afterUtc: after, config: cfg, takenUtc: taken, rngSeed: `m-${i}` });
    taken.push(scheduledAtUtc);
    const p = localPartsFromUtc(scheduledAtUtc, TZ);
    days.add(`${p.year}-${p.month}-${p.day}`);
  }
  // 6 mail, gunde en fazla 2 -> en az 3 farkli gune yayilmali.
  assert.ok(days.size >= 3, `beklenen >=3 gun, gelen ${days.size}`);
});
