# Outpost

Outpost is a graph-centered outreach and relationship tool. Your data lives in an
Obsidian-compatible markdown vault — people, companies, institutions, schools, and channels
are plain `.md` files with frontmatter. Outpost parses that vault, puts the relationship graph
at the center, and gives you a web interface plus a REST API for exploring it, reaching out,
and gathering new contacts.

Nothing is locked in a database you can't read. The vault is the source of truth; Outpost is a
lens over it.

## Features

- **Network** — the graph and a synchronized list view over the same query. Filter, highlight,
  or focus on a node's N-step neighborhood. Physics-driven layout, type-aware legend, and a
  side panel for any entity.
- **Reach** — the outreach surface: who you've contacted, who's a candidate, and the mails
  already written or writable. Mail is **read-only ingest** — Outpost never sends.
- **Gather** — a fleet of research agents (people finder, person/company scout, site scanner)
  that discover new contacts from your integrations. Every result lands in a **human-approved
  staging area** — agents propose, you accept into the vault.
- **Overview** — dashboard metrics: how many people reached, over how many days, daily mail
  volume, and the state of your network at a glance.
- **Copilot** — an owner-gated assistant drawer. Available only to the workspace owner; other
  users get a clean `403`.

## Quickstart

Requires **Node.js >= 22** and **git**.

```bash
git clone https://github.com/tunapro1234/outpost.git
cd outpost
npm install        # installs server + web dependencies too (postinstall)
npm start          # builds the web bundle (if missing) + starts the server → http://localhost:3002
```

Then open **http://localhost:3002**.

One-liner (checks Node/git, clones, installs, points you at `npm start`):

```bash
curl -fsSL https://raw.githubusercontent.com/tunapro1234/outpost/main/scripts/install.sh | bash
```

On first launch with no workspace configured, Outpost seeds a `demo` workspace from the bundled
`example-vault` so you have something to click through immediately.

## Architecture

Outpost is split into per-zone modules on both the server and the web client. Each zone owns its
routes/service on the server and its views on the client.

| Zone | Server (`server/modules/*`) | Web (`web/src/modules/*`) |
|------|------------------------------|----------------------------|
| Network | `network/` — graph + list API | `network/` — GraphView, ListView, FilterBar, panels |
| Reach | `reach/` — candidates, mails | `reach/` — ReachView |
| Gather | `gather/` — agent runner, scheduler, staging | `gather/` — GatherView, AgentsStrip |
| Overview | `overview/` — dashboard metrics | `overview/` — OverviewView |
| Profile | `profile/` — user info, password change | `profile/` — ProfileView |
| Mail | `mail/` — read-only maildir ingest | (feeds Reach) |
| Copilot | `copilot/` — owner-gated assistant, tmux bridge | `copilot/` — CopilotDrawer |
| Entity / Workspace | (served via network/config) | `entity/`, `workspace/`, `integrations/` |

Shared plumbing lives in `server/lib/` (vault parsing, config, workspace registry). The vault
itself is any Obsidian-style folder of markdown; see `example-vault/` for the layout.

## Configuration

All configuration is via `OUTPOST_*` environment variables (see `.env.example`). Everything has a
sensible default — none are required to run locally.

| Variable | Default | Purpose |
|----------|---------|---------|
| `OUTPOST_PORT` | `3002` | HTTP port the server listens on. |
| `OUTPOST_WORKSPACES` | `./data/workspaces` | Root folder holding one directory per workspace. Seeded with a `demo` workspace on first run. |
| `OUTPOST_VAULT` | *(unset)* | Point the default workspace at a single vault folder directly. |
| `OUTPOST_MAIL_DATA` | *(unset)* | Read-only Maildir root to ingest mail headers from. Unset → mail ingest is off. |
| `OUTPOST_USERS` | *(unset)* | users.yaml with profile records. Unset → Profile endpoints report "not configured". |
| `OUTPOST_HTPASSWD` | *(unset)* | htpasswd file rewritten by the password-change endpoint. Unset → disabled. |
| `OUTPOST_DEFAULT_USER` | *(unset)* | Identity assumed when the reverse proxy omits `X-Remote-User`. Unset → identity-gated endpoints return 401. Set to your username for a single-user local install. |
| `OUTPOST_COPILOT_MODEL` | `claude-opus-4-8` | Model used by the Copilot runner. |
| `OUTPOST_CLAUDE_BIN` | `claude` | Path to the `claude` CLI binary for Copilot. |
| `OUTPOST_COPILOT_TMUX` | `outpost-copilot` | tmux session name for the Copilot bridge. |

Optional integrations degrade gracefully when their backend is absent: mail returns empty with a
single warning, Copilot shows a clear message if the `claude` binary is missing, and Gather
reports a readable error if the shared browser (`ws://127.0.0.1:3333`) isn't running — the server
never crashes.

## Design values

- **No mail is ever sent without explicit human approval.** The mail module is read-only ingest;
  there is no send/SMTP code, by design.
- **Agents only stage — humans accept into the vault.** Gather agents propose contacts into a
  staging area; nothing enters your vault until you approve it.
- **Your data lives in plain markdown you own.** The Obsidian-compatible vault is the source of
  truth. Delete Outpost and your data is still just files you can read.

## Documentation

Design notes and the spec-first contracts live in [`docs/`](docs/README.md) — start there for the
architecture (`docs/DESIGN.md`) and the per-zone specs.

## License

Outpost is licensed under the **GNU General Public License v3.0** — see [`LICENSE`](LICENSE).

Copyright (C) 2026 Tuna Gül
