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


// Kurumun graf kanıtları: takım/program/kanal bağları (FTC/FRC kayıtları vb.).
// Bunlar YAYIMLANMIŞ kayıtlardan gelen doğrulanmış kancalardır: yazar "tebrik +
// değer köprüsü" için kullanır, alıcıya işini yapıp yapmadığını SORMAZ.
function employerEvidence(company, index, limit = 4) {
  if (!company) return [];
  const evidence = [];
  for (const edge of index.edges) {
    const otherId = edge.source === company.id
      ? edge.target
      : edge.target === company.id ? edge.source : null;
    if (!otherId) continue;
    const other = index.entities.get(otherId);
    if (!other || other.meta.type !== "channel") continue;
    evidence.push({
      name: other.meta.name,
      label: cleanLabel(edge.label) ?? null,
      program: other.meta.program ?? null,
      city: (["city", "il", "sehir"].map((k) => other.meta[k]).find((v) => typeof v === "string" && v.trim()) ?? null),
    });
    if (evidence.length >= limit) break;
  }
  return evidence;
}


// Konum: İstanbul dışıysa yüz yüze görüşme teklif edilmez (Tuna, 2026-07-17 —
// "İstanbul dışındaysa ben gidemeyebilirim"). Kurumun (yoksa kişinin) şehri.
function cityOf(meta) {
  for (const key of ["city", "il", "sehir", "district", "ilce"]) {
    const value = meta?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
function isIstanbul(city) {
  return /istanbul/i.test((city ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, ""));
}

export function buildPersonBrief(person, index, signals) {
  const meta = person?.meta ?? {};
  const { company, edge, meaning } = resolveEmployer(person, index);
  const scored = scorePerson(person, index, signals);
  const hooks = hookList(meta);
  const lead = leadParagraph(person?.body);

  const employerRelation = cleanLabel(edge?.label);
  const cleanedMail = meta.mail ? cleanMail(meta.mail) : null;
  const evidence = employerEvidence(company, index);

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
      mail_probe: meta.mail_probe ?? "not_used",
      mail_state: meta.mail_state ?? "none",
      scan_state: meta.scan_state ?? "unscanned",
      scan_depth: Number.isFinite(meta.scan_depth) ? meta.scan_depth : null,
    },
    employer: company
      ? { id: company.id, name: company.meta.name, type: company.meta.type,
          relation: employerRelation, meaning,
          city: cityOf(company.meta) }
      : null,
    location: (() => {
      const evidenceCity = evidence.find((item) => item.city)?.city ?? null;
      const city = cityOf(company?.meta) ?? evidenceCity ?? cityOf(meta);
      return { city, istanbul: isIstanbul(city), known: Boolean(city) };
    })(),
    hooks,
    evidence,
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
  const probeLabel = {
    passed: "doğrulandı (RCPT probe kabul)", not_found: "DOĞRULANMADI (kutu yok)",
    catch_all: "doğrulanamaz (catch-all sunucu)", blocked: "probe engellendi (tekrar denenecek)",
    no_mx: "MX yok", not_used: "henüz probe edilmedi", invalid: "geçersiz",
  }[person.mail_probe] ?? person.mail_probe;
  lines.push(`E-posta: ${mailNote} — probe: ${probeLabel}`);
  lines.push(`Tarama: ${person.scan_state}${person.scan_depth != null ? `, derinlik ${person.scan_depth}` : ""}`);
  if (brief.evidence?.length) {
    lines.push(`Kurum kanıtları (yarışma/takım/program — YAYIMLANMIŞ, tebrik+değer köprüsü için kullan):\n${brief.evidence
      .map((item) => `- ${item.name}${item.program ? ` [${item.program}]` : ""}${item.label ? ` (${item.label})` : ""}`)
      .join("\n")}`);
  }
  lines.push(brief.hooks.length
    ? `Hooks: ${brief.hooks.join("; ")}`
    : (brief.evidence?.length
      ? "Hooks: kişiye özel hook yok, KURUM KANITLARINI kullan (yukarıda)"
      : "Hooks: doğrulanmış hook yok (hook uydurma; alıcıya kendi işini sorma)"));
  if (brief.location?.known) {
    lines.push(`Konum: ${brief.location.city}${brief.location.istanbul ? "" : " (İstanbul DIŞI)"}`);
    lines.push(brief.location.istanbul
      ? "CTA: İstanbul içi, yüz yüze kısa ziyaret/dinleme teklif edilebilir."
      : "CTA KISITI: İstanbul dışı. YÜZ YÜZE ZİYARET/UĞRAMA TEKLİF ETME. Sadece kısa telefon/online görüşme ya da 'kısa bir özet ileteyim mi' teklifi kur.");
  } else {
    lines.push("Konum: bilinmiyor. Güvenli taraf: yüz yüze ziyaret teklif etme, telefon/online görüşme ya da özet teklifi kur.");
  }
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
