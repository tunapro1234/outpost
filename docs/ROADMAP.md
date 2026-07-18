# Outpost — Production Roadmap

Status date: 2026-07-18. Owner: Tuna. This is the honest state + the prioritized path to
production. Effort tags: **S** (≤ half a day), **M** (1–3 days), **L** (a week+).

---

## 1. System state today (one paragraph)

Outpost is a graph-centered outreach tool: a markdown vault (people/companies/institutions/
schools/channels, `## İlişkiler` relation lines → edges, parsed by `server/lib/vault.mjs`)
mirrored into a per-workspace SQLite DB (`<workspace>/outpost.db`, Node 22 built-in
`node:sqlite`, WAL — `server/lib/db.mjs` + `mailer/store.mjs` DAO; live: 1864 entities,
3385 edges). On top of it: gather agents (site-scanner scrape+classify is real; staging →
human accept/reject → vault git commit), read-only mail ingest (maildir ro-mount →
`server/modules/mail/`), and a complete outreach mail pipeline
(`server/modules/mailer/`): AI drafts with full generation provenance → score-gated human
approval → recipient-timezone send scheduling (Tue–Thu working-hour windows, jitter,
rolling rate limit) → a 60 s dispatch tick that renders the final mail (tracking pixel,
wrapped click links, Message-ID) — **in hard dry-run: nothing has ever been emailed**.
Open/click tracking (honest about proxy-prefetch noise), reply-cancel, follow-up *timing*,
maildb provenance records, and a reply-rate Insights/Tracking UI are all live. Three
independent code reviews (Opus/Fable/GPT) found no blockers; the dry-run gate is airtight
and SQL is parameterized. What is **not** done: a real Brevo relay (no SMTP/API client
exists in the codebase at all), reply threading via Message-ID, the follow-up *writer*
mechanism (undecided), LinkedIn (design only, `docs/LINKEDIN.md`), and a cleanup backlog
(§3). 166 tests green.

---

## 2. Milestone 1 — Go-live: real mail sending (the #1 near-term goal)

The dry-run gate in `mailer/dispatch.mjs` requires **all three** of: runtime
`OUTPOST_DISPATCH_MODE=brevo`, the send row's *persisted* `dispatch_mode === "brevo"`
(set at schedule time — a send scheduled as dry-run can never go live retroactively), and
an actual `relay` function. Today no relay exists and nothing passes one to
`dispatchDueSends` in `app.mjs`. Remaining steps, in order:

| # | Step | Effort | Notes |
|---|------|--------|-------|
| 1 | **Deliverability prerequisites** — SPF/DKIM/DMARC for the from-domain (`destek@probotstudio.com`) verified in Brevo; from-address alignment | S | Do first; sending without this burns the domain |
| 2 | **Implement the Brevo relay** — a `relay(rendered, {workspace, mail})` function (Brevo SMTP or API), wired into `createApp` → `dispatchDueSends`; secrets via env (`BREVO_API_KEY`), never in repo | S–M | The gate + payload rendering already exist; this is the only missing piece of plumbing |
| 3 | **Message-ID threading** — send with our generated Message-ID (render.mjs already mints one); persist the relay-returned id; add `In-Reply-To`/`References` on follow-ups; match inbound replies by `References` instead of today's person_id+date heuristic | M | Reliable reply-matching is what makes reply-cancel, follow-up suppression, and reply-rate analytics trustworthy at volume |
| 4 | **Per-account send caps for live mode** — `schedule.mjs` already has `rollingPerHour`/`dailyMax` (default 0 = unlimited); enforce a non-zero hard daily cap whenever mode is brevo, per from-account | S | Belt-and-braces on top of the schedule spread |
| 5 | **Send-now / pause control** — a global per-workspace pause (halts the dispatch tick) and a per-mail "send now" with explicit confirm; UI keeps `dispatch_mode` read-only (no casual brevo toggle — deliberate) | S–M | Human kill-switch before anything goes live |
| 6 | **Bounce/complaint handling** — the Brevo webhook endpoint exists (`POST /t/brevo/:ws`, optional `OUTPOST_BREVO_WEBHOOK_KEY`); wire hard-bounce/spam-complaint events to a suppression list that blocks future sends to that address | M | Non-negotiable for deliverability |
| 7 | **Monitoring** — alert on dispatch `failed` counts, relay errors, webhook silence; daily send digest to Tuna | S | See §5 |
| 8 | **Canary rollout** — first sends to own/test addresses; then live with `dailyMax` ≈ 5 for a week; review opens/replies/bounces; raise gradually | S | Explicit Tuna sign-off gates each step |

**Safety gates that stay:** human approval per mail (score-threshold assisted), persisted
per-send `dispatch_mode`, reply-cancel before dispatch, atomic send-claim (no double-send),
schedule windows + jitter. Go-live = steps 1–6 done + Tuna flips the env switch.

---

## 3. Engineering hardening & cleanup backlog (open items from the reviews)

Already done (not listed): render link fix, jitter guard, persisted dispatch_mode,
rate-limiter ledger, importLegacy guard, busy_timeout, atomic send-claim, atomic+idempotent
approve, outbox.jsonl dual-write removed (SQLite is the single source).

Ordered by payoff-per-effort:

| # | Item | Effort | Payoff |
|---|------|--------|--------|
| 1 | **Rename collisions** — `mail/` (inbox ingest) vs `mailer/` (outreach) vs `reach/mails`; `scheduler.mjs` (follow-up timer) vs `schedule.mjs` (send-window math) | S–M | Every new engineer (and agent) trips on these; cheap to fix now, expensive later |
| 2 | **DST validation for custom send windows** | S | Correctness: a user-defined window across a DST shift can misfire; `schedule.mjs` tz math is Intl-based but window configs aren't validated |
| 3 | **Paginate tracking/maildb reads** — `tracking.mjs`/`maildb.mjs` load all mails/events into memory per request | M | Fine at hundreds of sends; will hurt at thousands. Keep the Tracking page and all `/mailtracking` metrics — owner requirement, do NOT remove |
| 4 | **Collapse `createApp`'s 42-option bag** into per-module config objects (`{ mailer: {...}, assistant: {...}, gather: {...} }`) | M | `app.mjs` option surface is the biggest source of wiring mistakes; do before adding LinkedIn/relay options |
| 5 | **Split `mailer/` (29 files)** into send-pipeline vs writing-studio (drafts/calibration/writer/skills) | M–L | Clear ownership boundaries; do together with #1 so paths move once |

Do #1 and #4 **before** Milestone 1 adds more wiring, or immediately after — not never.

---

## 4. Feature roadmap (phased)

### Phase A — Mail go-live (now)
§2 above. Depends on: Brevo account + DNS access. Size: **M** total.

### Phase B — Follow-up writer mechanism (design decision, then build)
Partial infra exists: `FollowUpScheduler` ticks hourly and `followup.mjs` already drafts
follow-up 1/2 (4 + 5 days, close after 5 more) as ordinary staged three-variant drafts
through the normal approval queue; the newer SQLite `followup` table + gap-days settings
are **not** wired to a trigger/writer. The *mechanism* — who authors the follow-up when
it's due — is **undecided** (Tuna: "tartışıcaz"). Options on the table:
(a) **DB job wakes the writer**: due follow-up row → one-shot writer run (headless
model call via the existing `writer.mjs` path) → draft lands in the normal approval queue.
No long-lived process. *(Recommended: stateless, crash-safe, reuses approval gate.)*
(b) **Persistent "sleeping" tmux mail-agent** that wakes on schedule.
Decision needed from Tuna; then wiring is **M**. Dependency: none (works in dry-run too),
but only *valuable* after Phase A. Without this, "sequences" don't exist — this is the
core product loop.

### Phase C — Existing-mail import (compec corpus)
A large human-written mail dump from "compec" is coming. The importer
(`mailer/import.mjs`, `POST /mail/import`) is generic-JSON, idempotent, marks
source/human-authored, feeds the human-vs-AI analytics split. **Blocked on the real dump
format** — write the concrete parser when the first file lands. Size: **S–M**. High
analytics payoff: a human-written baseline for reply-rate comparison.

### Phase D — LinkedIn integration (design done: `docs/LINKEDIN.md`)
Summary of the design: use **Tuna's own LinkedIn Pro account** (explicitly authorized,
own-outreach only) via the shared Playwright browser server (`/srv/browser`, residential
IP, stealth, headful); a one-time supervised login captures `storageState` which Outpost
stores **encrypted, git-ignored, outside the vault** and injects per context (the browser
server is stateless — Outpost owns the session); hard per-day caps in code (≤30 profile
views, ≤15 searches, later ≤10 connects/messages), randomized 20–90 s pacing,
working-hours only, single serialized context, **fail closed on any checkpoint**; every
finding becomes a staged proposal through the existing gather staging UI (never a direct
vault write); official LinkedIn API rejected as effectively closed to individuals; a paid
3rd-party data API (proxycurl-style) noted as a lower-account-risk alternative worth
pricing.

- **D1 — Read-only enrichment** (person/company enrich, verify-still-employed): fixes the
  employer-vs-alumni edge-label problem that mail briefs suffer from. Slots into the
  existing stub at `gather/person-deepener.mjs:298`. Depends on: Pro account ready,
  one-time login, Tuna signing the risk checklist (LINKEDIN.md §8). Size: **M–L**.
- **D2 — Decision-maker search**: bounded people-search → ranked candidates → staged.
  Only after D1 runs clean for weeks. Size: **M**.
- **D3 — Approved outreach actions** (connect/InMail, one at a time, per-action human
  approval, never a queue): only if Tuna enables it at all. Size: **M**.

### Phase E — Gather real data sources
Google Places / Serper adapters for company/person discovery. Today `scrape-classify`,
`deepen-person`, and `write-mail` have real runner implementations; `dedup-review` and
`link-discovery` are explicit "not implemented" stubs, and discovery has no external data
source beyond site scraping + Codex web search. Needs API keys + per-source rate/cost
budgets; results flow through existing staging. Size: **M**. Independent of mail phases.

### Phase F — Multi-workspace / multi-user
Workspace scoping (`/api/ws/:ws/`), users.yaml + htpasswd, and `X-Remote-User` owner-gating
exist; only `probot` runs today. Needed: a second real workspace (compec), login-based
copilot separation, per-workspace agent hierarchies, workspace-scoped secrets. Size: **M–L**.
Do after Phase C (compec data motivates it).

### Phase G — Analytics deepening: reply-rate optimization loop
Insights already breaks reply-rate down by model/engine/tone/score/hour/etc., with
reliability handling for noisy opens. Next: feed results back — calibration weights from
observed replies, A/B tone experiments, human-vs-AI baseline (needs Phase C), template
retirement. Needs real send volume first (Phase A) — with dry-run data it's fiction.
Size: **M–L**, ongoing.

---

## 5. Infra / ops needs for production

| Area | What's needed | Effort |
|------|---------------|--------|
| **Backups** | Nightly `sqlite3 .backup` (or `VACUUM INTO`) of every `<workspace>/outpost.db` + tar of the vault + `users.yaml`/htpasswd, shipped **off-box**; vault is git — ensure it pushes to a remote, not just local commits. The SQLite DB is now store-of-record for sends/events: losing it loses send history | S–M |
| **Secrets** | `BREVO_API_KEY`, `OUTPOST_BREVO_WEBHOOK_KEY`, LinkedIn `storageState` (encrypted, chmod 600, outside vault — gather auto-commits vault files, a cookie must never land in git), browser `.ws_token`. All via systemd env / root-only files, never in repo | S |
| **Browser-token hygiene** | The shared browser server token is **hard-coded in `/srv/browser/smoke.mjs`** and embedded in the systemd `--path` — anyone reading that file has full browser access. Not this repo's file, but flag upstream: read `.ws_token` at runtime, never inline | S (flag) |
| **LinkedIn session persistence** | The browser server is stateless and shared; Outpost must own the LinkedIn `storageState` lifecycle (inject per context, detect expiry, alert for manual re-login) — see LINKEDIN.md §2 | (in D1) |
| **Monitoring/alerting** | `/healthz` probe; alerts on dispatch failures, follow-up scheduler errors, mail-ingest stalls, Brevo webhook silence, disk usage (WAL files), systemd restarts. Route to Tuna (WhatsApp bridge exists server-side) | M |
| **Auth perimeter** | The app *trusts* `X-Remote-User` (no app-level session/login middleware); nginx basic-auth is the sole perimeter. Keep the app bound to localhost only — any direct port exposure bypasses auth entirely. Public exceptions stay limited to `/t/*` | S (verify) |
| **Single-box risk** | Everything (app, DBs, vault, browser, mail ro-mount) is one machine. Backups off-box is the minimum; a restore drill is the test | S |

---

## 6. Risks & open decisions

- **LinkedIn account ban** — real, non-zero even done carefully; detection is behavioral,
  caps are necessary but not sufficient. Accepted only because it's Tuna's own account at
  human-manual volume, fail-closed on any warning. Alternative if risk appetite drops:
  paid 3rd-party data API. **Open: Tuna must sign the §8 checklist in LINKEDIN.md.**
- **Deliverability/spam** — new sending domain + cold outreach = spam-folder risk. Mitigate:
  DNS auth, tiny canary volume, slow ramp, suppression on bounces/complaints, honest
  opt-out handling. Reply-rate analytics are the smoke detector.
- **Follow-up writer mechanism undecided** (Phase B) — blocks the sequence loop; decide
  (a) vs (b) before building anything on top.
- **compec dump format unknown** — importer stays generic until the first real file;
  don't speculative-build a parser.
- **Open-tracking noise** — proxy prefetch makes "opened" soft; already handled honestly
  (bot-flagging, reliability.mjs, clicks-first). Keep the Tracking page and metrics —
  owner decision, not up for removal.
- **Cleanup debt vs feature pace** — the mailer split/renames (§3) get more expensive with
  every feature added on top; schedule them, don't let them float.

---

## 7. Recommended next 3 things

1. **Go-live plumbing (§2 steps 1–6):** DNS auth → Brevo relay + Message-ID threading →
   caps, pause control, bounce suppression → canary at ~5/day. Everything else in the mail
   product is waiting on real sends.
2. **Decide + wire the follow-up writer (Phase B)** — recommend option (a), DB-job-wakes-
   writer through the normal approval queue. This turns single mails into sequences, which
   is the actual product.
3. **Knock out cleanup items §3 #1 + #4** (renames + createApp config objects) in one
   short pass before relay/LinkedIn wiring adds more surface — then start LinkedIn D1 as
   soon as Tuna's Pro account and signed risk checklist are ready.
