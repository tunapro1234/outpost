// server/modules/mailer/schedule.mjs
//
// PURE send-time scheduling for outreach mail. No I/O, no DB, no filesystem,
// no Math.random, no Date.now(). Every "now" enters through arguments so the
// whole module is deterministic and unit-testable.
//
// The idea: when a mail is approved we do NOT send immediately. We schedule it
// for a time in the RECIPIENT's timezone when people actually read email,
// jittered inside working-hour windows, and rate-limited ("rolling") so an
// approved batch does not all fire in the same minute.
//
// Timezone math uses ONLY the built-in Intl.DateTimeFormat with a `timeZone`
// option. We never touch Date's local getters/setters, so the server's own
// timezone is irrelevant to the result.

/* ------------------------------------------------------------------ *
 * Timezone helpers (Intl-based)
 * ------------------------------------------------------------------ */

// Reusable formatter cache keyed by tz. Building an Intl.DateTimeFormat is
// relatively expensive, and this module may be called once per mail in a batch.
const _fmtCache = new Map();

function _formatter(timeZone) {
  let fmt = _fmtCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    _fmtCache.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * Given a UTC Date and an IANA timezone, return the local wall-clock parts.
 * weekday follows the JS getDay() convention: 0=Sun .. 6=Sat.
 *
 * @param {Date} utcDate
 * @param {string} timeZone  IANA tz, e.g. "Europe/Istanbul"
 * @returns {{year:number,month:number,day:number,hour:number,minute:number,second:number,weekday:number}}
 */
export function localPartsFromUtc(utcDate, timeZone) {
  const parts = _formatter(timeZone).formatToParts(utcDate);
  const get = (type) => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  // 24h formatters sometimes emit "24" for midnight; normalize to 0.
  let hour = get("hour");
  if (hour === 24) hour = 0;
  const year = get("year");
  const month = get("month");
  const day = get("day");
  // Derive weekday deterministically from the local calendar date. Building a
  // UTC date from the local Y/M/D and reading getUTCDay() gives the correct
  // 0=Sun..6=Sat index without depending on locale weekday strings.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour, minute: get("minute"), second: get("second"), weekday };
}

/**
 * Offset (localWallClock - UTC) in milliseconds for the given instant/tz.
 * Positive east of UTC (Istanbul = +3h => +10800000).
 */
function _offsetMs(utcDate, timeZone) {
  const p = localPartsFromUtc(utcDate, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - utcDate.getTime();
}

/**
 * Given a desired LOCAL wall-clock in a timezone, return the UTC Date for it.
 *
 * We first pretend the wall-clock is already UTC, measure the tz offset at that
 * instant, subtract it, then re-measure once more so a DST/offset boundary
 * crossing between the guess and the answer is corrected. Two iterations are
 * enough for whole-minute scheduling in every real-world zone.
 *
 * @param {{year:number,month:number,day:number,hour:number,minute:number,second?:number}} local
 * @param {string} timeZone
 * @returns {Date}
 */
export function utcFromLocalWallClock(local, timeZone) {
  const { year, month, day, hour, minute, second = 0 } = local;
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let ts = naive;
  for (let i = 0; i < 2; i++) {
    const offset = _offsetMs(new Date(ts), timeZone);
    ts = naive - offset;
  }
  return new Date(ts);
}

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

/**
 * Default scheduling policy. startMin/endMin are minutes-from-midnight LOCAL.
 *  - windows: 09:30-11:00 (570-660) and 13:30-15:00 (810-900)
 *  - weekdays: [2,3,4] = Tue/Wed/Thu (JS getDay convention, 0=Sun)
 *  - jitterMin: spread (in minutes) applied at the start of a window so mails
 *               in one batch do not all land on the window's first minute
 *  - rollingPerHour: max sends allowed in ANY sliding 60-min window
 *  - minGapMin: min minutes between two consecutive scheduled sends
 */
export const DEFAULT_SCHEDULE = {
  timezone: "Europe/Istanbul",
  windows: [
    { startMin: 570, endMin: 660 },
    { startMin: 810, endMin: 900 },
  ],
  weekdays: [2, 3, 4],
  jitterMin: 20,
  rollingPerHour: 12,
  minGapMin: 4,
};

function _clampNum(value, lo, hi, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Deep-ish merge of `overrides` onto DEFAULT_SCHEDULE with type validation.
 * Invalid fields are ignored (fall back to the default), numbers are clamped to
 * sane ranges. Always returns a complete, self-consistent config object.
 */
export function mergeSchedule(overrides = {}) {
  const o = overrides && typeof overrides === "object" ? overrides : {};

  const timezone =
    typeof o.timezone === "string" && o.timezone.trim()
      ? o.timezone.trim()
      : DEFAULT_SCHEDULE.timezone;

  // windows: keep only well-formed {startMin,endMin} with 0<=start<end<=1440.
  let windows = DEFAULT_SCHEDULE.windows.map((w) => ({ ...w }));
  if (Array.isArray(o.windows)) {
    const cleaned = o.windows
      .filter((w) => w && typeof w === "object")
      .map((w) => ({
        startMin: _clampNum(w.startMin, 0, 1440, NaN),
        endMin: _clampNum(w.endMin, 0, 1440, NaN),
      }))
      .filter((w) => Number.isFinite(w.startMin) && Number.isFinite(w.endMin) && w.startMin < w.endMin);
    if (cleaned.length) windows = cleaned;
  }

  // weekdays: integers 0..6, de-duplicated. Empty/invalid => default.
  let weekdays = [...DEFAULT_SCHEDULE.weekdays];
  if (Array.isArray(o.weekdays)) {
    const cleaned = [...new Set(o.weekdays)].filter(
      (d) => Number.isInteger(d) && d >= 0 && d <= 6,
    );
    if (cleaned.length) weekdays = cleaned.sort((a, b) => a - b);
  }

  return {
    timezone,
    windows: windows.sort((a, b) => a.startMin - b.startMin),
    weekdays,
    jitterMin: _clampNum(o.jitterMin, 0, 600, DEFAULT_SCHEDULE.jitterMin),
    rollingPerHour: Math.round(_clampNum(o.rollingPerHour, 1, 600, DEFAULT_SCHEDULE.rollingPerHour)),
    minGapMin: _clampNum(o.minGapMin, 0, 600, DEFAULT_SCHEDULE.minGapMin),
  };
}

/* ------------------------------------------------------------------ *
 * Timezone resolution
 * ------------------------------------------------------------------ */

// Intentionally tiny. Outpost's outreach is Turkey-centric, so the honest MVP
// behaviour is "Istanbul unless we clearly recognise a foreign city". This is a
// deliberate simplification, not a full geocoder; extend the table as needed.
const _CITY_TZ = {
  london: "Europe/London",
  berlin: "Europe/Berlin",
  paris: "Europe/Paris",
  amsterdam: "Europe/Amsterdam",
  "new york": "America/New_York",
  "san francisco": "America/Los_Angeles",
  dubai: "Asia/Dubai",
};

/**
 * Resolve an IANA timezone from a loose location hint. Accepts a string
 * (treated as a city name) or an object `{ city, istanbul, known }`.
 * Defaults to "Europe/Istanbul" for Turkey / unknown inputs.
 *
 * NOTE: intentionally simple — see _CITY_TZ above.
 */
export function resolveTimezone(location) {
  const DEFAULT = DEFAULT_SCHEDULE.timezone;
  if (!location) return DEFAULT;

  if (typeof location === "string") {
    return _CITY_TZ[location.trim().toLowerCase()] || DEFAULT;
  }

  if (typeof location === "object") {
    if (location.istanbul) return DEFAULT;
    // an explicit, already-IANA tz wins if it looks like one ("Area/City")
    if (typeof location.known === "string" && location.known.includes("/")) {
      return location.known;
    }
    if (typeof location.city === "string") {
      return _CITY_TZ[location.city.trim().toLowerCase()] || DEFAULT;
    }
  }
  return DEFAULT;
}

/* ------------------------------------------------------------------ *
 * Deterministic pseudo-randomness
 * ------------------------------------------------------------------ */

/**
 * Map a number/string seed to a stable value in [0,1). FNV-1a style hash, so
 * two different mails (different seeds) in the same batch spread across the
 * jitter range, but the SAME seed always yields the SAME slot. No Math.random.
 */
export function rand01(seed) {
  const str = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Murmur3 fmix32 avalanche finalizer. Without it, seeds sharing a long prefix
  // and differing only in the trailing character (e.g. sequential mail IDs
  // "mail-0001", "mail-0002") map to nearly identical values and collide into
  // the same jitter bucket. The finalizer diffuses every input bit.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  h >>>= 0;
  return h / 4294967296;
}

/* ------------------------------------------------------------------ *
 * Rolling / gap constraints
 * ------------------------------------------------------------------ */

const MIN = 60000;
const HOUR = 3600000;

// Would adding `tsMs` keep every sliding 60-min window <= perHour AND respect
// minGap against all already-taken times? `taken` is a sorted array of ms.
function _slotFits(tsMs, taken, cfg) {
  const gapMs = cfg.minGapMin * MIN;
  for (const t of taken) {
    if (Math.abs(t - tsMs) < gapMs) return false;
  }
  // Adding tsMs can only overflow 60-min windows that CONTAIN tsMs, i.e. those
  // starting in (tsMs-HOUR, tsMs]. Candidate window-starts are existing sends
  // in that range, plus tsMs itself.
  const all = taken.concat(tsMs).sort((a, b) => a - b);
  for (const start of all) {
    if (start <= tsMs - HOUR || start > tsMs) continue;
    let count = 0;
    for (const x of all) {
      if (x >= start && x < start + HOUR) count++;
    }
    if (count > cfg.rollingPerHour) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Human-readable reason string
 * ------------------------------------------------------------------ */

const _TR_DAYS = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"]; // 0=Sun..6=Sat

function _reason(slotUtc, cfg, window) {
  const p = localPartsFromUtc(slotUtc, cfg.timezone);
  const hh = String(p.hour).padStart(2, "0");
  const mm = String(p.minute).padStart(2, "0");
  const part = window.startMin < 720 ? "sabah penceresi" : "öğleden sonra penceresi";
  return `${_TR_DAYS[p.weekday]} ${hh}:${mm} (${cfg.timezone}, ${part})`;
}

/* ------------------------------------------------------------------ *
 * Core scheduling
 * ------------------------------------------------------------------ */

function _addLocalDays(parts, n) {
  // Normalise local calendar arithmetic (month/year rollover) via Date.UTC.
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const HORIZON_DAYS = 120; // safety bound; a valid weekday/window is found long before this

/**
 * Find the next allowed send slot at or after `afterUtc`.
 *
 * A slot is allowed when its LOCAL time falls on a configured weekday and
 * inside a configured window. Inside the chosen window we start at a
 * seed-jittered minute (so batch mails spread out), then walk forward until the
 * slot also satisfies the rolling-per-hour and minGap constraints against
 * `takenUtc`. If a window/day cannot fit the slot, we advance to the next
 * window, then the next allowed day.
 *
 * @param {Object}   opts
 * @param {Date}     opts.afterUtc            earliest instant (usually now/approval time)
 * @param {Object}   opts.config              a full config (see mergeSchedule / DEFAULT_SCHEDULE)
 * @param {Date[]}   [opts.takenUtc]          already-scheduled UTC Dates to rate-limit against
 * @param {number|string} opts.rngSeed        deterministic jitter seed
 * @returns {{ scheduledAtUtc: Date, windowReason: string }}
 */
export function nextSendTime({ afterUtc, config, takenUtc = [], rngSeed }) {
  const cfg = mergeSchedule(config); // tolerate partial/loose configs
  const tz = cfg.timezone;
  const afterMs = afterUtc.getTime();
  const taken = takenUtc.map((d) => d.getTime()).sort((a, b) => a - b);
  const r = rand01(rngSeed);

  const startParts = localPartsFromUtc(afterUtc, tz);
  const windows = cfg.windows; // already sorted by mergeSchedule

  for (let dayOffset = 0; dayOffset <= HORIZON_DAYS; dayOffset++) {
    const cal = _addLocalDays(startParts, dayOffset);
    const weekday = new Date(Date.UTC(cal.year, cal.month - 1, cal.day)).getUTCDay();
    if (!cfg.weekdays.includes(weekday)) continue;

    for (const w of windows) {
      const winLen = w.endMin - w.startMin;
      if (winLen <= 0) continue;

      // Jitter only across the leading part of the window, capped by its length.
      const jitterSpan = Math.min(cfg.jitterMin, winLen - 1);
      const startMinute = w.startMin + Math.floor(r * (jitterSpan + 1));

      for (let minute = startMinute; minute < w.endMin; minute++) {
        const slotUtc = utcFromLocalWallClock(
          { year: cal.year, month: cal.month, day: cal.day, hour: Math.floor(minute / 60), minute: minute % 60 },
          tz,
        );
        const ts = slotUtc.getTime();
        if (ts < afterMs) continue; // not yet reached the earliest instant
        if (_slotFits(ts, taken, cfg)) {
          return { scheduledAtUtc: slotUtc, windowReason: _reason(slotUtc, cfg, w) };
        }
      }
    }
  }

  throw new Error(`nextSendTime: no valid slot within ${HORIZON_DAYS} days`);
}

/**
 * Schedule a follow-up `gapDays` after `afterUtc`, then snap forward to the
 * next valid window using the same rules as nextSendTime. Same return shape.
 *
 * @param {Object} opts
 * @param {Date}   opts.afterUtc
 * @param {number} opts.gapDays   e.g. 3
 * @param {Object} opts.config
 * @param {Date[]} [opts.takenUtc]
 * @param {number|string} opts.rngSeed
 */
export function followupDueTime({ afterUtc, gapDays, config, takenUtc = [], rngSeed }) {
  const days = Number.isFinite(gapDays) ? gapDays : 0;
  const earliest = new Date(afterUtc.getTime() + days * 24 * HOUR);
  return nextSendTime({ afterUtc: earliest, config, takenUtc, rngSeed });
}
