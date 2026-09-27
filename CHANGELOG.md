# Changelog

All notable changes to Loom, **newest entry on top**.

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and commit messages
follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). No versions are
tagged yet — V1 ships when `docs/trd.md` is satisfied end to end, so everything until then
lands under **Unreleased**. Each of the six phases in `docs/plan.md` adds one entry as it
completes.

## Unreleased

### Phase 2 — The resumable upload engine · 2026-09-15

Files go straight from the browser into your Drive, in 8 MiB chunks, and survive a network drop
or a page reload. The confirmed offset is always the number Drive reports in its `Range` header
— never the client's own arithmetic — so a resumed upload cannot silently diverge. A spent retry
ladder asks Drive where it got to rather than guessing. Queue state lives in IndexedDB; the
session URI is treated as the write credential it is, and never logged or put in a URL.

The engine owns its own state and React only watches it: separate subscriptions for the file
list, each row, and a derived summary, with progress throttled so a queue of hundreds of files
does not re-render the world on every chunk.

Nothing about this phase touches the server. No endpoint was added, no byte of media reaches us,
and the "delete your local copy" affordance stays hidden until Drive has confirmed the uploaded
size back to the browser (TRD §9).

Verified against a real account across nine checks, including a 250 MB upload interrupted by
pulling the network, the same upload interrupted by a page reload, and a deliberately wrong file
offered at the resume prompt — which is refused rather than appended.

### Phase 1 — Auth and the Drive handshake · 2026-09-14

Sign in with Google, get a `loom` folder in your own Drive, and stay signed in across a server
restart. The `users` table is hand-written SQL applied by hand and introspected into the Prisma
client, with a startup check that names the file to run when a table is missing. Refresh tokens
are AES-256-GCM encrypted at rest; the Google access token lives in browser memory only and is
never persisted or logged. Sessions are a signed `httpOnly` cookie, with `helmet` and an
`Origin` allow-list on POST.

Two departures from `docs/trd.md`, both deliberate and recorded in
`agent-cache/plans/phase-1-auth.md`. The sign-in scope adds `openid email` to §5.1's
`drive.file`, because §4 keys the user table on Google's `sub` and email and `drive.file`
returns neither. And `POST /api/auth/signout` joins §8's four endpoints, because §5 describes
how the session cookie is created but never how it ends — and an `httpOnly` cookie cannot be
cleared by the client.

Two open questions closed: a popup-mode code exchange wants the calling page's origin, not the
literal `postmessage` that older samples insist on; and Drive's `thumbnailLink` does load in a
plain `<img src>`, with no auth header, which retires the largest risk standing in front of
Phase 4.

### Phase 0 — Scaffold · 2026-09-14

The gate every later phase runs. npm workspaces over `backend/` and `web/`, TypeScript on
Node 25 with no build step, MySQL 8 via Compose reached through Prisma 7's mariadb adapter,
Zod-validated config, pino logging, Express 5 answering `GET /healthz` with the database's real
state, graceful shutdown, and a Vite React app reaching the API through a dev proxy.
`npm run verify` and `npm run test:e2e` are green — 20 unit tests, 24 end-to-end checks.

No schema, no Google, no OAuth, no upload code; those begin in Phase 1.

A spike also confirmed that Google exposes both `Location` and `Range` to cross-origin
JavaScript, which retires the single largest architectural risk in the project: the
direct-to-Drive resumable upload design in `docs/trd.md` §2 is viable as specified.
