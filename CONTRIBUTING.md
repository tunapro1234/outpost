# Contributing to Outpost

Thanks for your interest in Outpost. This guide covers the local dev loop, how the codebase is
organized, and what a change needs before it lands.

## Dev setup

Requires **Node.js >= 22**.

```bash
git clone https://github.com/tunapro1234/outpost.git
cd outpost
npm install                 # server + web dependencies (postinstall)
```

Run the pieces you're working on:

```bash
npm run dev                 # server in watch mode (server/index.mjs)
npm --prefix web run dev    # web client via Vite dev server (hot reload)
npm test                    # server test suite (node --test)
npm run build               # production web build (tsc -b && vite build)
```

For day-to-day UI work, run the server (`npm run dev`) and the Vite dev server
(`npm --prefix web run dev`) side by side. For a production-like check, use `npm start` from the
repo root.

## Module & zone map

Outpost is organized by **zone**. Each zone has a self-contained folder on the server and,
usually, a matching one on the web client:

- **server/modules/** — `network`, `reach`, `gather`, `overview`, `profile`, `mail`, `copilot`.
- **web/src/modules/** — `network`, `reach`, `gather`, `overview`, `profile`, `entity`,
  `workspace`, `integrations`, `copilot`.
- **server/lib/** — shared plumbing (vault parsing, config, workspace registry, slug).

### Spec-first: touch a zone, read its spec

Outpost is developed spec-first. Before changing a zone, read the relevant `docs/SPEC-*.md`.
The specs are the contract; the code follows them. Start from [`docs/README.md`](docs/README.md)
for the index — for example, work on Gather means reading `docs/SPEC-GATHER2.md`, mail means
`docs/SPEC-MAIL.md`, the three-zone product shape is `docs/SPEC-V3.md`. If your change alters
behavior a spec describes, update the spec in the same PR.

## Tests

- `npm test` must be **green** before you open a PR.
- Add or update tests alongside behavior changes; server modules keep their tests under
  `server/modules/<zone>/test/`.
- For any UI change, also run `npm run build` and confirm it builds clean (TypeScript included).

## Style

- **Match the surrounding code.** Follow the conventions already present in the file you're
  editing rather than introducing new patterns.
- Server is **ESM** (`.mjs`), web client is **TypeScript** + React.
- **Do not touch Turkish data values.** Vault content, seed data, and Turkish domain strings are
  intentional — leave them as-is unless the change is specifically about that data.
- Keep secrets out of the repo.

## Pull requests

1. Branch from `main`.
2. Keep the change focused on one zone/concern where possible.
3. Ensure `npm test` is green (and `npm run build` for UI work).
4. Update the relevant `docs/SPEC-*.md` if behavior changed.
5. Describe what changed and why; link the spec section if relevant.
