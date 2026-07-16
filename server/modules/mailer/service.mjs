import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { normalizeSearch } from "../../lib/slug.mjs";
import { hasMail } from "../reach/service.mjs";

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SIGNALS_PATH = path.join(MODULE_DIRECTORY, "signals.yaml");
const AUTHORITY_VALUES = new Set(["founder", "exec", "manager", "staff", "unknown"]);
const QUEUE_MAIL_STATES = new Set(["none", "closed"]);

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function deepMerge(base, override) {
  const merged = { ...objectValue(base) };
  for (const [key, value] of Object.entries(objectValue(override))) {
    merged[key] = objectValue(value) === value && objectValue(merged[key]) === merged[key]
      ? deepMerge(merged[key], value)
      : value;
  }
  return merged;
}

async function readSignals(filePath, { missing = false } = {}) {
  try {
    return objectValue(yaml.load(await fs.readFile(filePath, "utf8"), {
      schema: yaml.JSON_SCHEMA,
    }));
  } catch (error) {
    if (missing && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function loadSignals(workspace) {
  const defaults = await readSignals(DEFAULT_SIGNALS_PATH);
  if (!workspace?.directory) return defaults;
  const override = await readSignals(path.join(workspace.directory, "signals.yaml"), {
    missing: true,
  });
  return override ? deepMerge(defaults, override) : defaults;
}

function finiteScore(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : fallback;
}

function configScore(map, key, fallback = 0) {
  return finiteScore(objectValue(map)[key], fallback);
}

function normalizedState(value, fallback) {
  return typeof value === "string" && value.trim()
    ? normalizeSearch(value).replaceAll(" ", "_")
    : fallback;
}

export function inferAuthority(meta = {}) {
  const configured = normalizedState(meta.authority, "");
  if (AUTHORITY_VALUES.has(configured)) {
    return { authority: configured, inferred: false };
  }

  const role = [meta.role, meta.rol]
    .find((value) => typeof value === "string" && value.trim());
  const normalizedRole = normalizeSearch(role);
  if (!normalizedRole) return { authority: "unknown", inferred: true };
  if (/\b(founder\w*|kurucu\w*|ceo)\b/u.test(normalizedRole)) {
    return { authority: "founder", inferred: true };
  }
  if (/\b(mudur\w*|director\w*|direktor\w*|head)\b/u.test(normalizedRole)) {
    return { authority: "exec", inferred: true };
  }
  if (/\b(manager\w*|lead\w*|koordinator\w*)\b/u.test(normalizedRole)) {
    return { authority: "manager", inferred: true };
  }
  return { authority: "staff", inferred: true };
}

function entityMatchesReference(entity, reference) {
  if (!entity || typeof reference !== "string") return false;
  const cleaned = reference.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|", 1)[0].trim();
  return normalizeSearch(entity.id) === normalizeSearch(cleaned) ||
    normalizeSearch(entity.meta.name) === normalizeSearch(cleaned);
}

function adjacentEntities(person, index) {
  const ids = new Set();
  for (const edge of index.edges) {
    if (edge.source === person.id) ids.add(edge.target);
    if (edge.target === person.id) ids.add(edge.source);
  }
  return [...ids].map((id) => index.entities.get(id)).filter(Boolean);
}

export function resolveCompany(person, index) {
  const companies = [...index.entities.values()]
    .filter((entity) => entity.meta.type === "company");
  const references = [person.meta.company_id, person.meta.company]
    .flat(Infinity)
    .filter((value) => typeof value === "string" && value.trim());
  for (const reference of references) {
    const company = companies.find((entity) => entityMatchesReference(entity, reference));
    if (company) return company;
  }
  return adjacentEntities(person, index)
    .filter((entity) => entity.meta.type === "company")
    .sort((left, right) => companyImportance(right).value - companyImportance(left).value ||
      left.meta.name.localeCompare(right.meta.name, "tr", { sensitivity: "base" }))[0] ?? null;
}

export function companyImportance(company) {
  if (typeof company?.meta?.importance === "number" && Number.isFinite(company.meta.importance)) {
    return { value: finiteScore(company.meta.importance), source: "importance" };
  }
  if (typeof company?.meta?.score === "number" && Number.isFinite(company.meta.score)) {
    return { value: finiteScore(company.meta.score), source: "score" };
  }
  return { value: 50, source: "default" };
}

function hookItems(value) {
  return (Array.isArray(value) ? value.flat(Infinity) : [value])
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim());
}

function advantageSchool(school, signals) {
  if (typeof school !== "string" || !school.trim()) return null;
  const normalizedSchool = normalizeSearch(school);
  return Object.entries(objectValue(signals.advantage_schools))
    .map(([name, value]) => ({ name, value: finiteScore(value) }))
    .filter(({ name }) => normalizedSchool.includes(normalizeSearch(name)))
    .sort((left, right) => right.value - left.value)[0] ?? null;
}

function hookBonus(person, index, signals) {
  const hooks = hookItems(person.meta.hooks);
  const weights = objectValue(signals.signal_weights);
  const perHook = finiteScore(weights.hook, 34);
  const schoolWeight = finiteScore(weights.advantage_school, 1);
  const connectionWeight = finiteScore(weights.common_connection, 34);
  const cap = finiteScore(weights.cap, 100);
  const school = advantageSchool(person.meta.school, signals);
  const commonConnection = adjacentEntities(person, index)
    .some((entity) => entity.meta.type === "person");
  const raw = hooks.length * perHook +
    (school ? schoolWeight * school.value : 0) +
    (commonConnection ? connectionWeight : 0);
  return {
    value: Math.min(cap, raw),
    hooks,
    school,
    commonConnection,
  };
}

function rounded(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function companyReason(company, importance) {
  if (!company) {
    return `Şirket önemi ${importance.value}/100: ilişkili şirket bulunamadığı için varsayılan 50 kullanıldı.`;
  }
  if (importance.source === "importance") {
    return `Şirket önemi ${importance.value}/100: ${company.meta.name} importance değeri kullanıldı.`;
  }
  if (importance.source === "score") {
    return `Şirket önemi ${importance.value}/100: ${company.meta.name} için importance olmadığından score değeri kullanıldı.`;
  }
  return `Şirket önemi ${importance.value}/100: ${company.meta.name} için importance ve score olmadığından varsayılan 50 kullanıldı.`;
}

function authorityReason(result, value, meta) {
  if (!result.inferred) {
    return `Yetki ${value}/100: authority alanındaki ${result.authority} seviyesi kullanıldı.`;
  }
  const role = [meta.role, meta.rol]
    .find((item) => typeof item === "string" && item.trim());
  return role
    ? `Yetki ${value}/100: “${role.trim()}” rolünden ${result.authority} seviyesi çıkarıldı.`
    : `Yetki ${value}/100: authority ve rol bulunmadığı için unknown seviyesi kullanıldı.`;
}

function depthReason(state, value, scanDepth) {
  const detail = Number.isFinite(scanDepth) ? `, scan_depth ${scanDepth}` : "";
  return `Tarama derinliği ${value}/100: scan_state ${state}${detail} olarak değerlendirildi.`;
}

function hookReason(result) {
  const signals = [
    ...(result.hooks.length ? [`${result.hooks.length} hook`] : []),
    ...(result.school ? [`${result.school.name} okul sinyali`] : []),
    ...(result.commonConnection ? ["ortak bağlantı"] : []),
  ];
  return signals.length
    ? `Hook bonusu ${rounded(result.value)}/100: ${signals.join(", ")} hesaba katıldı.`
    : "Hook bonusu 0/100: yazılabilir hook, avantajlı okul veya ortak bağlantı bulunamadı.";
}

export function scorePerson(person, index, signals) {
  const company = resolveCompany(person, index);
  const importance = companyImportance(company);
  const authority = inferAuthority(person.meta);
  const authorityValue = configScore(signals.authority_scores, authority.authority, 15);
  const scanState = normalizedState(person.meta.scan_state, "unscanned");
  const depthValue = configScore(signals.depth_scores, scanState, 0);
  const hook = hookBonus(person, index, signals);
  const weights = objectValue(signals.score_weights);
  const score = rounded(
    importance.value * (weights.company_importance ?? 0.40) +
    authorityValue * (weights.authority ?? 0.25) +
    depthValue * (weights.depth ?? 0.20) +
    hook.value * (weights.hook_bonus ?? 0.15),
  );
  return {
    company,
    companyImportance: importance.value,
    score,
    reasons: [
      companyReason(company, importance),
      authorityReason(authority, authorityValue, person.meta),
      depthReason(scanState, depthValue, person.meta.scan_depth),
      hookReason(hook),
    ],
  };
}

function candidateState(person) {
  return {
    scanState: normalizedState(person.meta.scan_state, "unscanned"),
    mailState: normalizedState(person.meta.mail_state, "none"),
  };
}

function baseItem(person, scored) {
  return {
    id: person.id,
    name: person.meta.name,
    company_id: scored.company?.id ?? null,
    company_name: scored.company?.meta.name ?? null,
  };
}

export async function mailQueue(workspace) {
  const signals = await loadSignals(workspace);
  const queue = [];
  const awaitingScan = [];
  for (const person of workspace.index.entities.values()) {
    if (person.meta.type !== "person" || !hasMail(person)) continue;
    const { scanState, mailState } = candidateState(person);
    if (!QUEUE_MAIL_STATES.has(mailState)) continue;
    const scored = scorePerson(person, workspace.index, signals);
    if (scanState === "scanned") {
      queue.push({
        ...baseItem(person, scored),
        score: scored.score,
        reasons: scored.reasons,
        mail_state: mailState,
        scan_state: scanState,
      });
    } else if (scanState === "unscanned" || scanState === "partial") {
      awaitingScan.push({
        ...baseItem(person, scored),
        companyImportance: scored.companyImportance,
      });
    }
  }

  queue.sort((left, right) => right.score - left.score ||
    left.name.localeCompare(right.name, "tr", { sensitivity: "base" }));
  awaitingScan.sort((left, right) => right.companyImportance - left.companyImportance ||
    left.name.localeCompare(right.name, "tr", { sensitivity: "base" }));
  return {
    queue,
    awaitingScan,
    counts: { queue: queue.length, awaitingScan: awaitingScan.length },
  };
}
