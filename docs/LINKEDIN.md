# LinkedIn Integration — Design (research + plan, NOT built)

Status: **DESIGN ONLY.** No code written, no login performed, no scraping done. This
documents how Outpost *would* use Tuna's LinkedIn Pro account for outreach research once
it exists, and what we need before building. Owner authorization noted below.

---

## 0. Authorization & posture

- Historically the standing rule was **"no logged-in scraping with personal cookies."**
- Tuna is now getting **LinkedIn Pro** and **explicitly authorizes Outpost to use his own
  account for his own outreach business.** That lifts the "no personal cookies" rule *for
  his account, for his outreach* — it does **not** authorize mass scraping or automation
  that endangers the account.
- Design principle: **treat the account as a scarce, bannable human asset.** Everything is
  human-in-the-loop, low-volume, human-paced. When in doubt, do less.

---

## 1. How the shared browser server works (verified from infra)

Source: `/srv/browser` (`CLAUDE.md`, `smoke.mjs`, `package.json`), systemd unit
`/etc/systemd/system/browser-server.service`, nginx `browser.tunapro.xyz` vhost.

- **What it is:** `playwright run-server` (Chromium), systemd `browser-server.service`,
  `Restart=always`. Runs **headful under `xvfb-run`** (virtual display → real Chromium,
  better against bot detection) with `--unsafe` (clients may pass custom launch args for
  stealth). Deps include `playwright-extra` + `puppeteer-extra-plugin-stealth`.
- **How it's driven:** a **Playwright CDP-over-websocket** endpoint, not an HTTP API.
  Callers connect with the Playwright client:
  ```js
  const token = fs.readFileSync('/srv/browser/.ws_token','utf8').trim();
  const browser = await chromium.connect(`ws://127.0.0.1:3333/${token}`); // on-box, no TLS
  // remote:                      chromium.connect(`wss://browser.tunapro.xyz/${token}`)
  const ctx  = await browser.newContext({ /* storageState, locale, viewport ... */ });
  const page = await ctx.newPage();
  // ... work ...
  await browser.close(); // ALWAYS close — browsers must not pile up on the server
  ```
- **Auth = the path token** in `/srv/browser/.ws_token` (chmod 600). The token *is* the
  authority; it must never land in logs/commits. **Infra hygiene finding:** the token is
  currently hard-coded in `/srv/browser/smoke.mjs` (and embedded in the systemd
  `--path`). Not this project's file to fix, but flag it — anyone reading that file has
  full browser access. Prefer reading `.ws_token` at runtime, never inlining it.
- **IP:** the box is **residential (188.3.36.176)** — not a datacenter range, so it does
  not trip datacenter-IP blocks. Good for LinkedIn; also means the account's login IP is
  stable and consistent (a plus for anti-fraud, as long as we don't also log in from
  Tuna's laptop at the same time — see §3).
- **Multi-tenancy / session persistence — the critical gap:** the server is **shared
  across all agents** (one token, any agent can connect) and it is **stateless per site.**
  `browser.newContext()` returns a **fresh, empty context every time** — the server does
  **not** persist cookies/sessions per site or per tenant. There is no `storageState` kept
  server-side. **Therefore Outpost must own and inject the LinkedIn session state itself**
  (see §2). Because the token is shared, we must also assume other agents are using the
  same server; we get isolation only at the *context* level, and only for the lifetime of
  our connection.

Outpost already talks to this server: `server/modules/gather/runner.mjs` →
`openBrowserSession()` connects via `ws://127.0.0.1:3333/${token}`, hardens the context
(hides `navigator.webdriver`, `tr-TR` locale, 1365×768), and enforces **SSRF guards**
(`assertPublicSiteUrl` blocks private/loopback IPs before every navigation). The LinkedIn
adapter reuses this exact plumbing.

---

## 2. Auth / session model

**Goal:** establish Tuna's LinkedIn session **once**, persist it, and let Outpost drive
LinkedIn without ever handling raw credentials in code or on every run.

### One-time login → persisted `storageState`
1. A **one-time interactive login** happens in a Chromium context on the shared server
   (Tuna types email/password/2FA himself; MFA solved by a human). This is a supervised,
   manual step — Outpost does not automate the credential entry.
2. After login, we capture `await context.storageState()` → a JSON blob of cookies +
   localStorage (the `li_at` auth cookie et al.). **This blob is the session.**
3. Outpost stores that blob and injects it into every future context:
   `browser.newContext({ storageState: <blob> })`. No password ever re-entered until the
   cookie expires (LinkedIn `li_at` lasts up to ~1 year but can be invalidated by LinkedIn
   at any time; re-login is a manual step when that happens).

### What Outpost stores vs what the browser server stores
| | Stores |
|---|---|
| **Browser server (`/srv/browser`)** | Nothing LinkedIn-specific. Stateless. Just runs Chromium. |
| **Outpost** | The `storageState` JSON, **encrypted at rest, chmod 600, root-only, git-ignored**, e.g. `server/modules/linkedin/.session/state.json.enc` (NOT in the vault, NOT committed). Plus per-action audit log + rate-limit counters. |
| **Nobody** | Raw password / MFA secret. Never persisted; only Tuna, only at (re)login time. |

Notes:
- Keep the session **outside the git-tracked vault** — the gather pipeline auto-commits
  vault files (`stage.mjs` → `defaultGitCommit`); a session cookie must never be swept
  into a commit.
- One session = one identity. Never run two concurrent LinkedIn contexts from this session
  (looks like session hijacking to LinkedIn). Serialize all LinkedIn work through a single
  in-process queue.
- The stored state is a **bearer credential to Tuna's LinkedIn.** Treat it like the mail
  password: encrypted, access-logged, revocable (delete file → next run fails closed).

---

## 3. Coexistence with Tuna's normal LinkedIn use

LinkedIn's fraud models flag **impossible/《concurrent》sessions** and sudden geo/IP
changes. Because our browser box has a fixed residential IP and Tuna will also browse
LinkedIn from his own devices:
- Prefer running Outpost's LinkedIn work when Tuna is **not** actively on LinkedIn.
- Accept that our login IP (188.3.36.176, İstanbul residential) differs from Tuna's mobile
  network — this is normal "logs in from home desktop + phone" behavior *as long as it's
  not simultaneous and not geographically impossible*. It is. Keep it that way.
- Do **not** mix: don't have an automation tool and manual use hammering the account in the
  same minutes. Our low rate limits (§5) make this a non-issue if respected.

---

## 4. Useful actions, ranked by value ÷ risk

Ranked best-first (high value, low ban risk = read-only, human-triggered).

### Tier A — read-only enrichment (safest, Phase 1)
1. **Enrich a person/company entity from a LinkedIn profile.**
   Input: one `person` (or `company`) entity that already has a LinkedIn URL or an
   unambiguous name+company. Open the profile, read **current title + current employer**,
   location, headline, maybe current-company start date.
   **→ This directly fixes Outpost's "employer vs alumni" problem.** Outpost's graph
   encodes person→company as a relation line under `## İlişkiler` with a free-text label
   (`- [[Acme]] — label`); today a person linked to a company may be a *current employee*
   or an *alumnus/past*, and mail briefs can't always tell. LinkedIn's "current position"
   is the authoritative disambiguator: it lets us **propose** the correct edge label
   (e.g. `çalışıyor` vs `eski çalışan`) and the `role` meta field. Highest value, lowest
   risk — a profile view is the single most normal LinkedIn action.
2. **Verify a person still works somewhere.** Special case of #1: does current employer ==
   the company we think? Feeds a `verified_at` stamp on the person→company edge; prevents
   emailing "as a fellow X-employee" when they left. Very high value for outreach honesty.
3. **Company enrichment.** From a company page: size, industry, HQ, official name, maybe
   recent headcount. Feeds `company` entity meta and `companyImportance` scoring used by
   the mailer.

### Tier B — targeted discovery (Phase 2)
4. **Find the real decision-maker at a target org.** Given a `company` entity + a role
   brief ("who runs partnerships / who's the founder"), do a **bounded** People search
   (Sales Navigator if Pro includes it) and return a **short ranked candidate list** for
   human pick — not a bulk export. Each accepted candidate becomes a staged `person`
   proposal with a person→company `çalışıyor` edge. Medium risk: search + multiple profile
   views is more "automation-shaped," so cap tightly (§5).

### Tier C — outreach actions (Phase 3, per-action human approval ONLY)
5. **Connection request with a note** — **one at a time, each explicitly approved by Tuna
   in the UI.** Never a queue that auto-fires. Feeds the graph as an `outreach` edge/event
   and can precede an email.
6. **InMail / message** — same: draft proposed by the mail pipeline, **human approves the
   exact text and the send**, Outpost drives the click. Logged into the person's `##
   Mailler`-style history so the graph knows contact happened.

**Never:** auto-connect blasts, auto-message sequences, auto-endorse/follow loops, scraping
search results into a database, exporting connection lists, or visiting hundreds of
profiles to "warm" them. Those are exactly what gets accounts restricted.

### Mapping to Outpost's graph + mail
- Every LinkedIn finding becomes a **staged proposal** (markdown under
  `<workspace>/stage/`, same shape as `stage.mjs` / `writePersonEnrichmentStage`), never a
  direct write. Human accept → `decideStage` merges into the vault entity and git-commits.
- Enrichment writes `role`, current-employer edge label, and a **source line** citing the
  LinkedIn URL + date, mirroring the existing `## Kaynak` block.
- Corrected employer edges flow into the **mail brief** (reach/mailer), so outreach copy
  stops confusing current employees with alumni.

---

## 5. ToS & account safety — be honest about the risk

**Blunt truth for Tuna:** automating LinkedIn against its User Agreement can get the
account **restricted or permanently banned**, and a Pro/Sales-Navigator ban costs real
money and a real professional identity. LinkedIn's User Agreement prohibits scraping and
"using bots or automated methods." Detection is behavioral, not a published limit — bans
follow *patterns* (spikes, repetition, low acceptance, bot fingerprints), so "staying under
a number" is necessary but **not sufficient**. There is genuine, non-zero risk even done
carefully. We accept it only because (a) it's Tuna's own account, his own outreach, and
(b) we keep volume near *human-manual* levels.

### Concrete conservative limits (per account, hard caps in code)
Derived from community-reported safe ranges for warmed Premium accounts; we deliberately
sit at the **low end**.

| Action | Our cap | Community "risky above" |
|---|---|---|
| Profile views (read/enrich) | **≤ 30 / day**, ≤ ~150 / week | hundreds/day looks like scraping |
| People searches | **≤ 15 / day** | — |
| Connection requests (Phase 3) | **≤ 10 / day, ≤ 40 / week** | ~100/week is a top ban trigger |
| InMail / messages (Phase 3) | **≤ 10 / day**, human-approved each | mass messaging = spam flags |
| Concurrent LinkedIn contexts | **1** (serialized queue) | 2+ = hijack signal |

### Human-like pacing (mandatory)
- **Randomized delays** 20–90 s between page loads; never fixed-interval.
- **Working-hours only** (İstanbul daytime), with jitter; no 03:00 robotic bursts.
- **Scroll/dwell** on profiles before reading (don't `goto` → instant-parse → leave).
- **Session length** short: a handful of actions, then close the browser. No marathons.
- **Reuse the existing stealth** (`webdriver` hidden, stealth plugin, headful) already in
  `openBrowserSession`.
- **Fail closed & back off:** any checkpoint/CAPTCHA/"unusual activity" page → **stop
  immediately, alert Tuna, do not retry.** Treat one warning as a week-long cooldown.

### What NOT to do (explicit)
No bulk exports; no scraping of search-result lists into storage; no auto-connect/
auto-message without per-action approval; no running while Tuna is manually on LinkedIn; no
3rd-party growth tools on the same account; no ignoring a restriction and "trying again."

---

## 6. Proposed module design

Fits the existing **gather** pattern. Two viable shapes; **recommended: a gather source
adapter**, because the wiring already exists and there's a stub waiting for it.

> **Existing stub:** `server/modules/gather/person-deepener.mjs:298` —
> `// Extension point: add a "linkedin" source adapter here when account access is configured.`
> This is the intended seam. Phase 1 slots in here.

### Files (sketch)
```
server/modules/linkedin/
  session.mjs      # load/decrypt storageState, injects into browser.newContext(); one-time
                   # login helper (interactive, manual MFA); refresh/expiry detection
  browser.mjs      # openLinkedInSession() — like openBrowserSession() but with storageState
                   # + LinkedIn-specific stealth, the serialized single-context queue,
                   # rate-limit gate + human-pacing sleeper
  profile.mjs      # parseProfile(page) -> { name, headline, title, currentEmployer,
                   #   currentCompanyUrl, location, since } (pure parser, unit-testable)
  search.mjs       # (Phase 2) bounded people-search -> ranked candidate list
  enrich.mjs       # entity -> open profile -> parse -> propose stage entry/edge fix
  ratelimit.mjs    # persistent daily/weekly counters (JSON, chmod 600); hard caps §5
  actions.mjs      # (Phase 3) connect()/message() — each requires an approval token
  routes.mjs       # HTTP surface (below)
  .session/        # git-ignored: state.json.enc, counters.json  (NOT in vault)
```
Alternatively, register the LinkedIn agents in `gather/agents.yaml` with
`integration: linkedin` and `task: deepen-person`, letting the existing `GatherRunner`
schedule/journal them — reusing `stage.mjs`, `decisions.jsonl`, run journaling for free.
**Recommended:** implement the mechanics in `server/modules/linkedin/` but expose Phase-1
enrichment as a **gather agent** (`integration: linkedin`) so it inherits staging, the
overview UI, run history, and human accept/reject with zero new review UI.

### Data flow (Phase 1)
```
UI "enrich via LinkedIn" (person id)      [human-triggered]
  -> linkedin/enrich: rate-limit gate (§5) — refuse if over cap
  -> linkedin/browser: connect ws://127.0.0.1:3333, newContext({ storageState }), pace
  -> goto profile, human-like dwell, profile.mjs parse
  -> assertPublicSiteUrl-style guards; close browser
  -> propose: write stage/*.md  (role, current-employer edge label, source+date)
  -> HUMAN reviews in existing /stage UI -> decideStage accept
  -> vault entity updated + git commit -> edge label corrected
  -> flows into reach/mailer brief (employer vs alumni now correct)
```

### HTTP surface (mirrors gather)
- `POST /linkedin/enrich/:entityId` → 202, runs one bounded enrichment, writes a stage
  proposal. (Phase 1)
- `GET  /linkedin/status` → session valid? counters vs caps, last run, cooldown state.
- `POST /linkedin/session/login` → kick off the one-time interactive login flow.
- `POST /linkedin/search` → (Phase 2) decision-maker candidates for review.
- `POST /linkedin/action/:kind` → (Phase 3) connect/message; **requires an approval token
  minted by an explicit UI confirm**; single action; logged.
- Reuse existing `GET /stage` + `POST /stage/decision` for all human review.

Registered in `server/app.mjs` alongside `gatherRoutes` (same `resolveWorkspace` +
`defaultUser` pattern; `X-Remote-User` from nginx basic-auth for the write/action routes).

---

## 7. Phased plan

**Phase 1 — read-only enrichment (safest, build first).**
Session persistence + `openLinkedInSession` + profile parse + the three Tier-A actions
(enrich person, verify still-employed, enrich company) → staged proposals → human accept.
Slots into the `person-deepener.mjs:298` stub. Lowest risk, highest immediate payoff
(fixes employer/alumni). Rate caps + pacing + fail-closed from day one.

**Phase 2 — decision-maker finding.**
Bounded people search → ranked candidate list for human pick → staged `person` + edge.
More automation-shaped; tighter caps; only after Phase 1 has run clean for weeks.

**Phase 3 — approved outreach actions.**
Connection request / InMail, **one at a time, each explicitly approved by Tuna**, drafted
by the mail pipeline, logged into the graph's contact history. Never a queue, never a
sequence.

### Official API vs browser automation — recommendation
- **Official LinkedIn API is effectively closed to us.** Since 2015 all API access requires
  the **LinkedIn Partner Program**; it's **for incorporated companies, not individuals**,
  and the useful tiers (Marketing Developer Platform; People/Profile data) need a **manual
  partner review taking ~4 weeks to ~4 months, frequently rejected**, and are aimed at ads/
  page management — **not** "read a prospect's current employer." The **Sales Navigator API
  is closed to new partners.** So the API gives us essentially nothing for outreach
  research.
- **Recommendation: browser automation of Tuna's own Pro account**, at manual-human
  volume, human-in-the-loop, exactly as above. If Outpost ever becomes a real company doing
  ad/page work, revisit MDP — but it will never serve the prospect-enrichment use case.
- Note the option of a **paid 3rd-party LinkedIn data API** (Unipile/Phyllo/proxycurl-style)
  as a *lower-account-risk* alternative for Phase 1 enrichment (they carry the ToS risk, not
  Tuna's account). Trade-off: cost + their own ToS/legality questions + data freshness. Worth
  pricing before committing to browser automation if account-safety is the top concern.

---

## 8. What I need from Tuna when Pro is ready (checklist)

1. **One-time interactive login** in the shared browser (Tuna enters email/password and
   solves 2FA himself) so we can capture and persist `storageState`. Confirm the account is
   the **Pro** one and whether it includes **Sales Navigator** (affects Phase 2 search).
2. **Confirm which actions to enable**, phase by phase:
   - Phase 1 read-only enrichment — enable now? (recommended yes)
   - Phase 2 decision-maker search — later?
   - Phase 3 connect/InMail — enable at all? and confirm **every send stays per-action
     human-approved**.
3. **Accept the ban-risk stance in writing:** low caps (§5), human pacing, fail-closed on
   any warning, no mixing with his manual use. Confirm he's OK risking this specific account.
4. **API vs browser decision:** confirm we are **not** pursuing LinkedIn Partner/API (it's
   closed to individuals and useless for enrichment) and are going **browser-only** — OR
   that he wants us to price a paid 3rd-party data API instead of driving his account.
5. **Where to run / when:** confirm İstanbul working-hours execution and that he'll avoid
   heavy manual LinkedIn use during Outpost runs.
6. **Re-login expectation:** acknowledge that when the session cookie expires or LinkedIn
   invalidates it, he'll need to repeat step 1 (a manual re-login), and that we alert +
   pause on any checkpoint.

---

## Appendix — key sources / files
- Browser server: `/srv/browser/CLAUDE.md`, `/etc/systemd/system/browser-server.service`,
  nginx `browser.tunapro.xyz` vhost. Driver pattern already used at
  `server/modules/gather/runner.mjs` (`openBrowserSession`).
- Gather/staging pattern: `server/modules/gather/{stage,registry,routes,runner}.mjs`,
  `person-deepener.mjs` (stub at :298).
- Graph model: `server/lib/vault.mjs` (`TYPE_DIRECTORIES`, `## İlişkiler` relations →
  edges) — the employer/alumni edge label lives here.
- ToS / limits: LinkededHelper, PhantomBuster, LinkedSDR limit guides; Microsoft Learn
  LinkedIn Marketing API tiers; Phyllo/Getphyllo API-access guide (2025–2026).
