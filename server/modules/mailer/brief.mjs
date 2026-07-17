import { resolveEmployer, scorePerson } from "./service.mjs";

// A deterministic person brief — no LLM, <100ms — built from the vault entity,
// the employer edge, and the score. It is the SINGLE source that feeds both the
// Studio brief card (structured JSON) and the writer's context package
// (briefContextText): whatever the user sees in the card, the writer knows too.
// This replaces the ~15s luna "compileMailContext" call in the Studio path.

const MD_LINK = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g;

// Strip trailing source parentheticals like "([label](url), erişim: …)" so a
// finding reads as a clean sentence; the URLs are captured separately.
function stripCitations(text) {
  return String(text)
    .replace(/\(\s*\[[^\]]+\]\([^)]*\)[^)]*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .trim();
}

// The lead paragraph of a person's note is the deepener's factual summary.
function leadParagraph(body) {
  const withoutHeading = String(body ?? "").replace(/^\s*#\s+.*(?:\r?\n)+/, "");
  const block = withoutHeading
    .split(/\r?\n\s*\r?\n/)
    .map((piece) => piece.trim())
    .find((piece) => piece && !piece.startsWith("#") && !piece.startsWith("-"));
  return block ?? "";
}

function urlsFrom(text) {
  const urls = [];
  let match;
  const regex = new RegExp(MD_LINK.source, "g");
  while ((match = regex.exec(String(text ?? "")))) urls.push(match[1]);
  return [...new Set(urls)];
}

// The employer edge label often trails a citation ("… ([label](url), erişim …)")
// and a note like "(2022 kaynağında)" — keep the note, drop the raw citation.
function cleanLabel(label) {
  return label ? stripCitations(label) : null;
}

// A mail value may carry a "(tahmin)" / "(pattern)" annotation; the confidence
// chip conveys that, so strip it from the address itself to avoid duplication.
function cleanMail(mail) {
  return String(mail).replace(/\s*\((?:tahmin|pattern|guess)\)\s*$/i, "").trim();
}

function hookList(meta) {
  const value = meta?.hooks;
  return (Array.isArray(value) ? value : [value])
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim());
}

// verified = published/cited · scan = derived from a completed scan ·
// unverified = pattern-guessed or unlabeled.
function mailConfidence(meta) {
  if (!meta?.mail) return null;
  const source = String(meta.mail_source ?? "").toLowerCase();
  if (source === "pattern" || /tahmin/i.test(String(meta.mail))) return "unverified";
  return "verified";
}

function scanConfidence(meta) {
  return meta?.scan_state === "scanned" ? "scan" : "unverified";
}

export function buildPersonBrief(person, index, signals) {
  const meta = person?.meta ?? {};
  const { company, edge, meaning } = resolveEmployer(person, index);
  const scored = scorePerson(person, index, signals);
  const hooks = hookList(meta);
  const lead = leadParagraph(person?.body);

  const employerRelation = cleanLabel(edge?.label);
  const cleanedMail = meta.mail ? cleanMail(meta.mail) : null;

  const known = [];
  if (company) {
    known.push({
      label: "Employer",
      text: `${company.meta.name}${employerRelation ? ` — ${employerRelation}` : ""}`,
      confidence: meaning === "EMPLOYER" ? scanConfidence(meta) : "unverified",
    });
  }
  if (meta.role) {
    known.push({ label: "Role", text: String(meta.role), confidence: scanConfidence(meta) });
  }
  if (cleanedMail) {
    known.push({ label: "Email", text: cleanedMail, confidence: mailConfidence(meta) });
  }
  if (meta.alumni_school) {
    const dept = meta.alumni_dept ? `, ${meta.alumni_dept}` : "";
    known.push({ label: "Alumni", text: `${meta.alumni_school}${dept}`, confidence: scanConfidence(meta) });
  }

  const findings = lead ? [{ text: stripCitations(lead), urls: urlsFrom(person?.body) }] : [];

  return {
    person: {
      id: person.id,
      name: meta.name ?? person.id,
      role: meta.role ?? null,
      mail: cleanedMail,
      mail_state: meta.mail_state ?? "none",
      scan_state: meta.scan_state ?? "unscanned",
      scan_depth: Number.isFinite(meta.scan_depth) ? meta.scan_depth : null,
    },
    employer: company
      ? { id: company.id, name: company.meta.name, type: company.meta.type,
          relation: employerRelation, meaning }
      : null,
    hooks,
    score: { value: scored.score, reasons: scored.reasons },
    known,
    findings,
  };
}

// The deterministic prose context handed to the writer — the same facts the
// user sees in the card, formatted for the prompt. No fabricated facts; where a
// signal is weak the label says so ("doğrulanmamış", "tahmin").
export function briefContextText(brief) {
  const lines = [];
  const person = brief.person;
  lines.push(`Kişi: ${person.name}${person.role ? ` (${person.role})` : ""}`);
  if (brief.employer) {
    const unlabeled = brief.employer.meaning !== "EMPLOYER" ? " [ilişki doğrulanmamış]" : "";
    lines.push(`Kurum: ${brief.employer.name} (${brief.employer.type})` +
      `${brief.employer.relation ? `, ilişki: ${brief.employer.relation}` : ""}${unlabeled}`);
  } else {
    lines.push("Kurum: bağlı kurum bulunamadı");
  }
  const mailNote = person.mail
    ? `${person.mail}${brief.known.find((item) => item.label === "Email")?.confidence === "unverified" ? " (tahmin)" : ""}`
    : "yok";
  lines.push(`E-posta: ${mailNote}`);
  lines.push(`Tarama: ${person.scan_state}${person.scan_depth != null ? `, derinlik ${person.scan_depth}` : ""}`);
  lines.push(brief.hooks.length
    ? `Hooks: ${brief.hooks.join("; ")}`
    : "Hooks: doğrulanmış hook yok (hook uydurma; genel yönlendirme kalıbına geç)");
  lines.push(`Skor: ${brief.score.value}`);
  if (brief.score.reasons?.length) {
    lines.push(`Skor nedenleri:\n${brief.score.reasons.map((reason) => `- ${reason}`).join("\n")}`);
  }
  if (brief.findings.length) {
    lines.push(`Araştırma bulguları:\n${brief.findings
      .map((finding) => `- ${finding.text}${finding.urls?.length ? ` (kaynak: ${finding.urls[0]})` : ""}`)
      .join("\n")}`);
  }
  return lines.join("\n");
}
