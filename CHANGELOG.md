# Changelog

All notable changes to Loom, **newest entry on top**.

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and commit messages
follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). No versions are
tagged yet — V1 ships when `docs/trd.md` is satisfied end to end, so everything until then
lands under **Unreleased**. Each of the six phases in `docs/plan.md` adds one entry as it
completes.

## Unreleased

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
