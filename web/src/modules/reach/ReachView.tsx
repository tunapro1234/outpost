import { useMemo, useState } from "react";
import type { EntityListItem, MailItem, ReachStats } from "@/core/types";
import { STATUS_COLORS, STATUS_LABELS, TYPE_LABELS } from "@/core/theme";
import { trNormalize } from "@/core/normalize";
import { relativeTime } from "@/core/format";
import { IconAssistant, IconSearch } from "@/core/icons";
import DraftCard from "@/modules/mail/DraftCard";
import { useMailDrafts } from "@/modules/mail/useMailDrafts";
import { useMailDb } from "@/modules/mail/useMailDb";
import MailSent from "@/modules/mail/MailSent";
import MailInsights from "@/modules/mail/MailInsights";
import ExclusionsPanel from "./ExclusionsPanel";
import CalibrationStudio from "./CalibrationStudio";
import { useExclusions } from "./useExclusions";

interface Props {
  mails: MailItem[] | null; // null = endpoint not available yet
  stats: ReachStats | null;
  entities: EntityListItem[];
  onOpenEntity: (id: string) => void;
  // Calibration lives at /mail/calibration as a detached full-page sub-view.
  showCalibration: boolean;
  onOpenCalibration: () => void;
  onCloseCalibration: () => void;
}

type Tab = "drafts" | "sent" | "insights" | "inbound" | "candidates" | "exclusions";
type CandSort = "score" | "name";

const CANDIDATE_SCORE_MIN = 15;

function hasMail(mail: string | null | undefined): boolean {
  const m = (mail ?? "").trim();
  return m !== "" && m !== "-" && m !== "yok";
}

// "drafted 3h ago · by tuna" — the small provenance line on a draft. Renders
// nothing when there is no usable timestamp (older servers omit created_at).
function DraftMeta({
  draft,
}: {
  draft: { created_at?: string; author?: string | null };
}) {
  const rel = relativeTime(draft.created_at);
  if (!rel && !draft.author) return null;
  return (
    <span className="md-row-when">
      {rel ? `drafted ${rel}` : "drafted"}
      {draft.author ? ` · by ${draft.author}` : ""}
    </span>
  );
}

export default function ReachView({
  mails,
  stats,
  entities,
  onOpenEntity,
  showCalibration,
  onOpenCalibration,
  onCloseCalibration,
}: Props) {
  const [tab, setTab] = useState<Tab>("drafts");
  const [q, setQ] = useState("");
  const [candSort, setCandSort] = useState<CandSort>("score");
  const [candAsc, setCandAsc] = useState(false);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const drafts = useMailDrafts();
  const maildb = useMailDb();
  const exclusions = useExclusions();

  const list = mails ?? [];
  const sent = useMemo(() => list.filter((m) => m.direction === "out"), [list]);
  const inbound = useMemo(() => list.filter((m) => m.direction === "in"), [list]);

  // The canonical mail DB (approved mails with tracking + provenance) is the
  // primary Sent surface once live; the plain mail log is the fallback.
  const dbRecords = maildb.records ?? [];
  const filteredDb = useMemo(() => {
    const nq = trNormalize(q);
    if (!nq) return dbRecords;
    return dbRecords.filter((r) =>
      trNormalize(`${r.person.name} ${r.subject ?? ""} ${r.generation?.model ?? ""}`).includes(nq)
    );
  }, [dbRecords, q]);

  const kpis = stats ?? { sent: 0, replied: 0, replyRate: 0, pendingFollowUp: 0 };

  // ---- candidates: has mail, never written, score >= threshold ----
  const candidates = useMemo(() => {
    const nq = trNormalize(q);
    let out = entities.filter(
      (e) =>
        hasMail(e.mail) &&
        (e.mail_count ?? 0) === 0 &&
        (e.score ?? 0) >= CANDIDATE_SCORE_MIN
    );
    if (nq) {
      out = out.filter((e) =>
        trNormalize(`${e.name} ${e.city ?? ""} ${e.subtype ?? ""}`).includes(nq)
      );
    }
    out = [...out].sort((a, b) => {
      const cmp =
        candSort === "name"
          ? a.name.localeCompare(b.name, "tr")
          : (a.score ?? 0) - (b.score ?? 0);
      return candAsc ? cmp : -cmp;
    });
    return out;
  }, [entities, q, candSort, candAsc]);

  const filteredSent = useMemo(() => {
    const nq = trNormalize(q);
    if (!nq) return sent;
    return sent.filter((m) =>
      trNormalize(
        `${m.entity_name ?? ""} ${m.person_name ?? ""} ${m.subject ?? ""} ${m.summary}`
      ).includes(nq)
    );
  }, [sent, q]);

  const filteredInbound = useMemo(() => {
    const nq = trNormalize(q);
    if (!nq) return inbound;
    return inbound.filter((m) =>
      trNormalize(
        `${m.entity_name ?? ""} ${m.person_name ?? ""} ${m.subject ?? ""} ${m.summary}`
      ).includes(nq)
    );
  }, [inbound, q]);

  const draftList = drafts.drafts;
  const filteredDrafts = useMemo(() => {
    const all = draftList ?? [];
    const nq = trNormalize(q);
    if (!nq) return all;
    return all.filter((d) =>
      trNormalize(`${d.person.name} ${d.company.name}`).includes(nq)
    );
  }, [draftList, q]);

  // One faint line of KPIs, sitting to the right of the tabs — calm context,
  // never its own bar. e.g. "4 sent · 1 replied · 0 follow-ups".
  const kpiLine = `${kpis.sent} sent · ${kpis.replied} replied · ${kpis.pendingFollowUp} follow-up${
    kpis.pendingFollowUp === 1 ? "" : "s"
  }`;

  const MailTable = ({ rows }: { rows: MailItem[] }) => (
    <table className="grid mails-grid">
      <thead>
        <tr>
          <th style={{ width: 108 }}>Date</th>
          <th>Person</th>
          <th>Company</th>
          <th>Subject</th>
          <th style={{ width: 92 }}>Direction</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.id}>
            <td className="mono">{m.date ?? "—"}</td>
            <td>{m.person_name ?? "—"}</td>
            <td>
              {m.entity_id ? (
                <button className="link-btn" onClick={() => onOpenEntity(m.entity_id)}>
                  {m.entity_name ?? m.entity_id}
                </button>
              ) : (
                "—"
              )}
            </td>
            <td>{m.subject ?? "—"}</td>
            <td>
              <span className={`dir-tag ${m.direction}`}>
                {m.direction === "out" ? "→ out" : "← in"}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (showCalibration) {
    return (
      <div className="view-pad mail">
        <CalibrationStudio
          onBack={onCloseCalibration}
          onCalibrationChanged={drafts.reload}
        />
      </div>
    );
  }

  const TABS: { k: Tab; label: string; count: number | null }[] = [
    { k: "drafts", label: "Drafts", count: draftList?.length || null },
    {
      k: "sent",
      label: "Sent",
      count: (maildb.records ? dbRecords.length : sent.length) || null,
    },
    { k: "insights", label: "Insights", count: null },
    { k: "inbound", label: "Inbound", count: inbound.length || null },
    { k: "candidates", label: "Candidates", count: candidates.length || null },
    {
      k: "exclusions",
      label: "Exclusions",
      count: exclusions.items?.length || null,
    },
  ];

  const activeLabel = TABS.find((t) => t.k === tab)?.label ?? "Mail";

  return (
    <div className="view-pad mail">
      {/* One header band: a big active-section title with thin text tabs
          beneath it on the left; the KPI line, search and Calibration share
          the same band on the right. A single hairline parts it from content. */}
      <header className="mail-header">
        <div className="mh-left">
          <h1 className="mh-title">{activeLabel}</h1>
          <nav className="mh-tabs" aria-label="Mail sections">
            {TABS.map((t) => (
              <button
                key={t.k}
                className={`mh-tab${tab === t.k ? " on" : ""}`}
                onClick={() => setTab(t.k)}
              >
                {t.label}
                {t.count != null && <span className="mh-badge">{t.count}</span>}
              </button>
            ))}
          </nav>
        </div>

        <div className="mh-right">
          <span className="mh-kpi">{kpiLine}</span>
          <label className="mh-search">
            <IconSearch size={14} />
            <input
              className="mh-search-input"
              placeholder={
                tab === "candidates"
                  ? "Search candidates…"
                  : tab === "drafts"
                    ? "Search drafts…"
                    : tab === "exclusions"
                      ? "Search excluded…"
                      : "Search mail…"
              }
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <button
            className="mh-cal"
            onClick={onOpenCalibration}
            title="Open the calibration studio"
          >
            <IconAssistant size={15} />
            Calibration
          </button>
        </div>
      </header>

      {tab === "exclusions" ? (
        <ExclusionsPanel
          state={exclusions}
          q={q}
          onOpenEntity={onOpenEntity}
        />
      ) : mails === null && tab !== "candidates" && tab !== "drafts" ? (
        <div className="empty-state">
          <div className="es-title">Mail service coming online</div>
          <div className="es-sub">
            We can't reach the workspace mail service just yet. Hang tight.
          </div>
        </div>
      ) : tab === "drafts" ? (
        draftList === null ? (
          <div className="empty-state">
            <div className="es-title">Draft service coming online</div>
            <div className="es-sub">
              We can't reach the draft service just yet. Once the mail-writer
              stages drafts, they'll line up here for your review.
            </div>
          </div>
        ) : filteredDrafts.length === 0 ? (
          <div className="empty-state">
            <div className="es-title">No drafts awaiting approval</div>
            <div className="es-sub">
              New drafts land here with their variants, score and reasons. You
              approve or reject each one before anything is queued.
            </div>
          </div>
        ) : (
          <div className="md-rows">
            {filteredDrafts.map((d) => {
              const open = openDraftId === d.id;
              const fu =
                d.followup_stage === 1
                  ? "Follow-up 1"
                  : d.followup_stage === 2
                    ? "Follow-up 2"
                    : "New";
              return (
                <div
                  key={d.id}
                  className={`md-rowwrap ${open ? "open" : ""}`}
                >
                  <button
                    className="md-row"
                    onClick={() => setOpenDraftId(open ? null : d.id)}
                  >
                    <span className="md-row-caret">{open ? "▾" : "▸"}</span>
                    <span className="md-row-person">{d.person.name}</span>
                    <span className="md-row-company">{d.company.name}</span>
                    <DraftMeta draft={d} />
                    {d.stale && (
                      <span
                        className="md-stale"
                        title="This draft is from before your latest calibration, so it will be rewritten automatically."
                      >
                        outdated, queued for rewrite
                      </span>
                    )}
                    <span className="md-row-variants">
                      {d.variants.length} variant
                      {d.variants.length === 1 ? "" : "s"}
                    </span>
                    <span className="md-row-status">{fu}</span>
                    <span className="md-row-score">{Math.round(d.score)}</span>
                  </button>
                  {open && (
                    <div className="md-rowbody">
                      <DraftCard
                        draft={d}
                        busy={drafts.busyId === d.id}
                        onApprove={async (id, payload) => {
                          await drafts.approve(id, payload);
                          setOpenDraftId(null);
                        }}
                        onReject={async (id, payload) => {
                          await drafts.reject(id, payload);
                          setOpenDraftId(null);
                        }}
                        onOpenEntity={onOpenEntity}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : tab === "sent" ? (
        // Mail DB live → full record view; else fall back to the mail log.
        maildb.records ? (
          <MailSent
            records={filteredDb}
            detail={maildb.detail}
            onOpenEntity={onOpenEntity}
          />
        ) : filteredSent.length === 0 ? (
          <div className="empty-state">
            <div className="es-title">No mail sent yet</div>
            <div className="es-sub">
              Every message you send lands here, right next to the person it
              went to.
            </div>
          </div>
        ) : (
          <MailTable rows={filteredSent} />
        )
      ) : tab === "insights" ? (
        <MailInsights analytics={maildb.analytics} />
      ) : tab === "inbound" ? (
        filteredInbound.length === 0 ? (
          <div className="empty-state">
            <div className="es-title">No replies yet</div>
            <div className="es-sub">
              When people write back to your outreach, you'll find their replies here.
            </div>
          </div>
        ) : (
          <MailTable rows={filteredInbound} />
        )
      ) : (
        // candidates
        <div className="cand-wrap">
          <div className="cand-head">
            <span className="cand-count">{candidates.length} candidates</span>
            <span className="cand-hint">
              has mail · never contacted · score ≥ {CANDIDATE_SCORE_MIN}
            </span>
            <div className="seg" style={{ marginLeft: "auto" }}>
              <button
                className={candSort === "score" ? "on" : ""}
                onClick={() => {
                  if (candSort === "score") setCandAsc((a) => !a);
                  else {
                    setCandSort("score");
                    setCandAsc(false);
                  }
                }}
              >
                Score {candSort === "score" && (candAsc ? "▲" : "▼")}
              </button>
              <button
                className={candSort === "name" ? "on" : ""}
                onClick={() => {
                  if (candSort === "name") setCandAsc((a) => !a);
                  else {
                    setCandSort("name");
                    setCandAsc(true);
                  }
                }}
              >
                Name {candSort === "name" && (candAsc ? "▲" : "▼")}
              </button>
            </div>
          </div>

          {candidates.length === 0 ? (
            <div className="empty-state">
              <div className="es-title">No candidates right now</div>
              <div className="es-sub">
                Entities with a mail address, a score of at least{" "}
                {CANDIDATE_SCORE_MIN}, and no mail sent yet appear here.
              </div>
            </div>
          ) : (
            <div className="cand-list">
              {candidates.map((c) => {
                const hook = c.hook;
                return (
                  <button
                    key={c.id}
                    className="cand-card"
                    onClick={() => onOpenEntity(c.id)}
                  >
                    <div className="cand-top">
                      <span className="cand-name">{c.name}</span>
                      <span className="cand-score">{c.score ?? "—"}</span>
                    </div>
                    <div className="cand-meta">
                      <span className="cand-type">{TYPE_LABELS[c.type]}</span>
                      {c.subtype && <span>· {c.subtype}</span>}
                      {c.city && <span>· {c.city}</span>}
                      {c.status && (
                        <span className="cand-status">
                          <span
                            className="ring"
                            style={{ background: STATUS_COLORS[c.status] }}
                          />
                          {STATUS_LABELS[c.status]}
                        </span>
                      )}
                    </div>
                    <div className="cand-mail">{c.mail}</div>
                    {hook ? (
                      <div className="cand-why">
                        <span className="cand-why-k">Why</span> {hook}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {(drafts.notice || exclusions.notice) && (
        <div
          className="control-toast md-notice"
          role="status"
          aria-live="polite"
          onClick={drafts.notice ? drafts.dismissNotice : exclusions.dismissNotice}
        >
          {drafts.notice || exclusions.notice}
        </div>
      )}
    </div>
  );
}
