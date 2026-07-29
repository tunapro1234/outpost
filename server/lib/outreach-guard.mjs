/**
 * Outreach guard — fields that must never reach an automated outreach flow.
 *
 * Phone numbers in the network vaults are hand-copied, given in person, and
 * carry an explicit `kimlik_guveni` (identity confidence) because the real risk
 * is not a malformed number but reaching the WRONG human. They exist so Tuna
 * can dial someone himself, one at a time. Nothing that generates, queues, or
 * sends a message may see them.
 *
 * This is enforced by construction: every path that hands entity frontmatter to
 * a generator/sender runs it through `redactForOutreach` first, so the field is
 * absent from the data rather than merely discouraged by a comment.
 */

export const OUTREACH_BLOCKED_META_KEYS = Object.freeze([
  "phone",
  "phone_source",
  "contact_channel",
  "kimlik_guveni",
  "whatsapp",
]);

const BLOCKED = new Set(OUTREACH_BLOCKED_META_KEYS);

/** Strip manual-contact fields from one frontmatter object (nulls included). */
export function redactForOutreach(meta) {
  if (!meta || typeof meta !== "object") return meta;
  const safe = {};
  for (const [key, value] of Object.entries(meta)) {
    if (BLOCKED.has(key)) continue;
    // Adapters keep the untouched foreign frontmatter under `source_meta`;
    // recurse so a Turkish `telefon:` cannot sneak back in through it.
    safe[key] = key === "source_meta" ? redactSourceMeta(value) : value;
  }
  return safe;
}

const BLOCKED_SOURCE_KEYS = new Set([
  "telefon",
  "telefon-kaynak",
  "telefon_kaynak",
  "cep",
  "gsm",
  "whatsapp",
  "kimlik-guveni",
  "kimlik_guveni",
]);

function redactSourceMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !BLOCKED_SOURCE_KEYS.has(key.toLowerCase())),
  );
}

/** True when an object still carries a blocked field — used by tests/asserts. */
export function hasBlockedOutreachField(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasBlockedOutreachField);
  return Object.entries(value).some(([key, nested]) =>
    BLOCKED.has(key) || BLOCKED_SOURCE_KEYS.has(key.toLowerCase())
      ? true
      : hasBlockedOutreachField(nested));
}
