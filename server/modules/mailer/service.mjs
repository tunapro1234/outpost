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
const EDGE_MEANING = Object.freeze({
  EMPLOYER: "EMPLOYER",
  ALUMNI: "ALUMNI",
  CONTEXT: "CONTEXT",
  UNLABELED: "UNLABELED",
  OTHER: "OTHER",
});
const EMPLOYER_LABEL_TERMS = [
  "kurucu", "mudur", "yonetici", "direktor", "koordinator",
  "sorumlu", "ogretmen", "egitmen", "temsilcisi", "baskan", "danisman", "mentor",
];
const CONTEXT_LABEL_TERMS = [
  "yaristigi", "kaydi", "kopru", "kaynak", "program", "sponsor bagi", "kanal",
];

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

function includesAny(value, terms) {
  return terms.some((term) => value.includes(term));
}

export function classifyEdgeLabel(label) {
  if (typeof label !== "string" || !label.trim()) return EDGE_MEANING.UNLABELED;
  const normalized = normalizeSearch(label);
  // Bir etiket kaynak/citation metninde başka rol sözcükleri taşıyabilir. Mezuniyet
  // anlamı bu yüzden işveren anlamından önce ve kesin dışlanır.
  if (normalized.includes("mezun")) return EDGE_MEANING.ALUMNI;
  if (includesAny(normalized, EMPLOYER_LABEL_TERMS)) return EDGE_MEANING.EMPLOYER;
  if (includesAny(normalized, CONTEXT_LABEL_TERMS)) return EDGE_MEANING.CONTEXT;
  return EDGE_MEANING.OTHER;
}

function authorityFromRole(role) {
  const normalizedRole = normalizeSearch(role);
  if (!normalizedRole) return "unknown";
  if (/\b(founder\w*|kurucu\w*|ceo)\b/u.test(normalizedRole)) return "founder";
  if (/\b(mudur\w*|director\w*|direktor\w*|head|yonetici\w*|baskan\w*)\b/u.test(normalizedRole)) {
    return "exec";
  }
  if (/\b(manager\w*|lead\w*|koordinator\w*|sorumlu\w*|temsilci\w*|danisman\w*|mentor\w*)\b/u.test(normalizedRole)) {
    return "manager";
  }
  return "staff";
}

function edgeRoleEvidence(label) {
  return String(label ?? "")
    .split(/\s+(?:\(|\[)|[.;]/u, 1)[0]
    .trim();
}

export function inferAuthority(meta = {}, employerLabel = null) {
  const configured = normalizedState(meta.authority, "");
  if (AUTHORITY_VALUES.has(configured)) {
    return { authority: configured, inferred: false, verified: true, source: "authority" };
  }

  if (classifyEdgeLabel(employerLabel) === EDGE_MEANING.EMPLOYER) {
    return {
      authority: authorityFromRole(employerLabel),
      inferred: true,
      verified: true,
      source: "employer_edge",
      evidence: edgeRoleEvidence(employerLabel),
    };
  }

  const role = [meta.role, meta.rol]
    .find((value) => typeof value === "string" && value.trim());
  if (!role) {
    return { authority: "unknown", inferred: true, verified: false, source: "missing" };
  }
  const inferred = authorityFromRole(role);
  const authority = ["founder", "exec"].includes(inferred) ? "manager" : inferred;
  // Frontmatter rolü tek başına founder/exec yetkisini doğrulamaz. Deepener'ın
  // doğruladığı authority alanı veya güvenilir employer kenarı yoksa tavan manager.
  return {
    authority,
    inferred: true,
    verified: false,
    source: "role",
    role: role.trim(),
    ...(inferred !== authority ? { uncappedAuthority: inferred } : {}),
  };
}

function adjacentRelations(person, index) {
  const relations = [];
  for (const edge of index.edges) {
    const relatedId = edge.source === person.id
      ? edge.target
      : edge.target === person.id ? edge.source : null;
    if (!relatedId) continue;
    const entity = index.entities.get(relatedId);
    if (entity) relations.push({ entity, edge });
  }
  return relations;
}

function adjacentEntities(person, index) {
  return [...new Map(adjacentRelations(person, index)
    .map(({ entity }) => [entity.id, entity])).values()];
}

// Kişinin "kurumu" her org tipi olabilir (vault'ta işveren çoğu zaman
// institution/school): tip önceliği company > institution > school,
// aynı tip içinde importance yüksek olan kazanır.
const ORG_TYPE_RANK = { company: 0, institution: 1, school: 2 };

export function resolveCompany(person, index) {
  return resolveEmployer(person, index).company;
}

function compareEmployerCandidates(left, right) {
  return (ORG_TYPE_RANK[left.entity.meta.type] - ORG_TYPE_RANK[right.entity.meta.type]) ||
    (companyImportance(right.entity).value - companyImportance(left.entity).value) ||
    left.entity.meta.name.localeCompare(right.entity.meta.name, "tr", { sensitivity: "base" });
}

export function resolveEmployer(person, index) {
  const relations = adjacentRelations(person, index)
    .filter(({ entity }) => entity.meta.type in ORG_TYPE_RANK)
    .map((relation) => ({
      ...relation,
      meaning: classifyEdgeLabel(relation.edge.label),
    }));
  const employer = relations
    .filter(({ meaning }) => meaning === EDGE_MEANING.EMPLOYER)
    .sort(compareEmployerCandidates)[0];
  if (employer) {
    return { company: employer.entity, edge: employer.edge, meaning: employer.meaning };
  }
  const unlabeled = relations
    .filter(({ meaning, entity }) => meaning === EDGE_MEANING.UNLABELED &&
      (entity.meta.type === "company" || entity.meta.type === "institution"))
    .sort(compareEmployerCandidates)[0];
  return unlabeled
    ? { company: unlabeled.entity, edge: unlabeled.edge, meaning: unlabeled.meaning }
    : { company: null, edge: null, meaning: null };
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

function authorityReason(result, value) {
  if (result.source === "authority") {
    return `Yetki ${value}/100: authority alanındaki ${result.authority} seviyesi kullanıldı.`;
  }
  if (result.source === "employer_edge") {
    return `Yetki ${value}/100: '${result.evidence}' kenar etiketi.`;
  }
  if (result.source === "role") {
    const cap = result.uncappedAuthority
      ? "; doğrulanmadığı için manager tavanı uygulandı"
      : "";
    return `Yetki ${value}/100: “${result.role}” frontmatter rolünden ${result.authority} seviyesi çıkarıldı${cap}.`;
  }
  return `Yetki ${value}/100: doğrulanmış authority, employer kenar rolü veya frontmatter rolü bulunmadığı için unknown seviyesi kullanıldı.`;
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

export function companyFit(company, signals) {
  if (!company) return { value: 0, source: "missing", key: null };
  const configured = objectValue(signals.buyer_subtypes);
  const subtype = normalizedState(company.meta.subtype, "");
  if (subtype && Object.hasOwn(configured, subtype)) {
    return { value: configScore(configured, subtype), source: "subtype", key: subtype };
  }
  const type = normalizedState(company.meta.type, "");
  if (type && Object.hasOwn(configured, type)) {
    return { value: configScore(configured, type), source: "type", key: type };
  }
  return { value: 0, source: "unmatched", key: subtype || type || null };
}

function fitReason(company, fit) {
  if (!company) return "Alıcı uyumu 0/100: doğrulanmış işveren bulunamadı.";
  if (fit.source === "subtype") {
    return `Alıcı uyumu ${fit.value}/100: ${company.meta.name} için ${fit.key} subtype profili kullanıldı.`;
  }
  if (fit.source === "type") {
    return `Alıcı uyumu ${fit.value}/100: ${company.meta.name} için ${fit.key} tip profili kullanıldı.`;
  }
  return `Alıcı uyumu 0/100: ${company.meta.name} için eşleşen buyer subtype/tip profili bulunamadı.`;
}

export function scorePerson(person, index, signals) {
  const employer = resolveEmployer(person, index);
  const company = employer.company;
  const importance = companyImportance(company);
  const authority = inferAuthority(person.meta, employer.edge?.label);
  const authorityValue = configScore(signals.authority_scores, authority.authority, 15);
  const scanState = normalizedState(person.meta.scan_state, "unscanned");
  const depthValue = configScore(signals.depth_scores, scanState, 0);
  const hook = hookBonus(person, index, signals);
  const fit = companyFit(company, signals);
  const weights = objectValue(signals.score_weights);
  const score = rounded(
    importance.value * (weights.company_importance ?? 0.34) +
    authorityValue * (weights.authority ?? 0.2125) +
    depthValue * (weights.depth ?? 0.17) +
    hook.value * (weights.hook_bonus ?? 0.1275) +
    fit.value * (weights.fit ?? 0.15),
  );
  return {
    company,
    employerEdge: employer.edge,
    companyImportance: importance.value,
    authority: authority.authority,
    authorityValue,
    fit: fit.value,
    score,
    reasons: [
      companyReason(company, importance),
      authorityReason(authority, authorityValue),
      depthReason(scanState, depthValue, person.meta.scan_depth),
      hookReason(hook),
      fitReason(company, fit),
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
    authority: scored.authority,
    fit: scored.fit,
  };
}

export async function mailQueue(workspace) {
  const signals = await loadSignals(workspace);
  const queue = [];
  const awaitingScan = [];
  const referral = [];
  const fitThreshold = finiteScore(signals.fit_threshold, 40);
  for (const person of workspace.index.entities.values()) {
    if (person.meta.type !== "person" || !hasMail(person)) continue;
    const { scanState, mailState } = candidateState(person);
    if (!QUEUE_MAIL_STATES.has(mailState)) continue;
    const scored = scorePerson(person, workspace.index, signals);
    // Kurum outreach kapsam dışıysa (Tuna reject kararı) o kurumdan KİMSE
    // kuyruğa/tarama listesine giremez.
    if (scored.company?.meta?.outreach === "excluded") continue;
    if (!scored.company || scored.fit < fitThreshold) {
      referral.push({
        ...baseItem(person, scored),
        reason: scored.company ? "low-fit org" : "no verified employer",
      });
      continue;
    }
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
  referral.sort((left, right) => left.reason.localeCompare(right.reason) ||
    left.name.localeCompare(right.name, "tr", { sensitivity: "base" }));
  return {
    queue,
    awaitingScan,
    referral,
    counts: {
      queue: queue.length,
      awaitingScan: awaitingScan.length,
      referral: referral.length,
    },
  };
}
