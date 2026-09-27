# Loom V1 — Implementation Plan

**Companion to:** `docs/trd.md` (v1.0.0, architecture locked)
**Status:** Draft
**Date:** 2026-09-10

---

## 1. How this plan is organised

Six phases, each a **vertical slice** that ends in something demoable. `docs/trd.md` §10 names
five milestones; this plan splits a **Phase 0 scaffold** off the front of its Phase 1, because
"configure the Google Cloud OAuth console" and "get a Node process talking to MySQL" fail for
entirely unrelated reasons, and a phase that mixes them makes the first failure hard to read.

The ordering is risk-first. The part most likely to disappoint is the **upload engine
(Phase 2)** — multi-gigabyte resumable transfers from a phone on a network that drops — so it
is built and proven before the HEIC pipeline, the gallery or any UI polish depends on it.

| Phase | Deliverable | TRD §10 | Rough size |
|---|---|---|---|
| 0 | Scaffold: workspaces, MySQL + Prisma, Express health check, Vite app | Phase 1 (part) | 1–2 d |
| 1 | Google OAuth handshake, `users` schema, app folder, session cookie | Phase 1 | 2–3 d |
| 2 | **Resumable direct-to-Drive upload engine** | Phase 2 | 4–6 d |
| 3 | HEIC pipeline: on-device WASM, ephemeral server transcode, decision modal | Phase 3 | 3–4 d |
| 4 | Gallery: Drive listing, thumbnails, silent refresh | Phase 4 | 3–4 d |
| 5 | Mobile hardening, deletion guardrail, privacy review | Phase 5 | 2–3 d |

Sizes assume solo part-time work and are for sequencing, not commitments.

---

## 2. Decisions this plan makes

These are choices `docs/trd.md` leaves open, or states two ways. Each is reversible unless
noted.

**Confirmed stack.** The backend is **TypeScript on Node 25, run directly** — Node strips types
natively, so there is no build step in development and `tsc --noEmit` is a pure typecheck gate.
**Express 5** inbound, **Prisma 7** over **MySQL 8** with the schema owned by hand (§2.1),
**`node:test`** as the runner, **Zod** for validation, **pino** for logging, **Vite + React +
TypeScript** for the client. This is the same stack proven end to end on this machine in the
Convergence project; every pitfall it cost is already recorded in `agent-cache/knowledge.md`
and is not to be rediscovered.

**Outbound HTTP is `fetch`, not axios.** Convergence took axios because interceptors gave one
home for a GitLab token and `responseType: 'stream'` kept a tarball off disk. Loom's server
makes two kinds of outbound call — Google's token endpoint and the Drive API — and neither
needs an interceptor. `fetch` is in Node 25, and the transcode path in §2.7 wants a web
`ReadableStream`, which is exactly what `fetch` accepts and returns.

### 2.1 We own the schema; Prisma is only the client

The schema is **hand-written SQL that we run ourselves**. Prisma is used for its typed client
and nothing else — **no `prisma migrate`, ever.**

```
backend/db/
├── schema.sql                  # complete current DDL — runnable on an empty database
└── changes/
    └── 001-<description>.sql   # incremental scripts as the schema evolves
```

The flow after any schema change:

```
edit db/schema.sql        (or add db/changes/NNN-*.sql)
        ↓
apply it yourself         mysql … < db/schema.sql
        ↓
npm run prisma:pull       live database → prisma/schema.prisma  (GENERATED)
        ↓
npm run prisma:generate   → typed client
```

**`prisma/schema.prisma` is generated output, not source.** It is committed so the client is
reproducible, but never hand-authored — `db pull` overwrites it.

TRD §4 supplies both a `schema.prisma` and the SQL DDL. Two things about that pair:

1. **The TRD's datasource block will not load.** Prisma 7 removed `url` from `datasource`;
   `url = env("DATABASE_URL")` fails with `P1012`. Connection settings live in
   `backend/prisma7.config.ts` for the CLI, and the client takes a driver adapter
   (`@prisma/adapter-mariadb` — the MariaDB driver speaks MySQL's protocol).
2. **Its model and its DDL disagree on column names.** The Prisma model says `refreshToken`
   and `appFolderId` with no `@map`; the DDL says `refresh_token` and `app_folder_id`. Under
   the flow above this resolves itself — introspection generates the model from the live
   columns, so the DDL wins. Do not hand-edit `schema.prisma` to match the TRD.

**What this costs, stated plainly:** nothing tracks which scripts have been applied to a given
database. There is no `_prisma_migrations` table and no drift detection. `schema.sql` stays
authoritative and must rebuild from empty; change scripts stay numbered. Phase 1 adds a startup
check that verifies the expected tables exist and names the file to run if they do not, so a
missing table surfaces as an instruction rather than a bare `Table 'loom.users' doesn't exist`.

**`DATABASE_URL` is the single database setting.** Prisma needs it for both `db pull` and the
client, so config carries one URL rather than five variables that could drift from it.

**Phase 0 needs no schema at all** — only MySQL running, `DATABASE_URL` valid, and a `SELECT 1`
proving the client connects.

### 2.2 The refresh token is encrypted at rest

**This changes TRD §4, deliberately.** The TRD stores `refresh_token TEXT` in plain text. A
Google refresh token for `drive.file` is a durable, self-renewing key to every file this app
has ever touched in a user's Drive. A plaintext column means one database dump — a backup on a
laptop, a stolen snapshot, a `SELECT` by anyone with read access — is permanent, silent access
to all of it, with no signal to the user. For an application whose first stated principle is
privacy, that is the wrong default.

**Decision:** the column stays `TEXT` and the schema keeps its shape; the value written into it
is AES-256-GCM ciphertext, formatted `v1:<b64 iv>:<b64 tag>:<b64 ciphertext>`, keyed by
`LOOM_TOKEN_KEY` (32 bytes, base64, required config, never committed). Encryption lives in
exactly one module — `backend/src/auth/token-crypto.ts` — and nothing else in the codebase
touches the raw value. The `v1:` prefix is there so key rotation has somewhere to go.

**What it does not buy:** an attacker holding both the database *and* the process environment
still wins. It converts "a database dump is game over" into "a database dump plus the running
host is game over" — the difference between an accident and a breach.

### 2.3 One session mechanism: an HTTP-only cookie

TRD §5.3 returns "an HTTP-only session cookie". TRD §8.3 then sends
`Authorization: Bearer <SESSION_JWT>`. Those are two mechanisms, and only one of them can be
`httpOnly` — a token the frontend can place in a header is a token JavaScript can read, which
is the thing `httpOnly` exists to prevent.

**Decision: the cookie is the only session mechanism.** `httpOnly`, `SameSite=Lax`, `Secure`
in production, signed. `/api/auth/refresh` and `/api/user/config` read it; no Loom endpoint
reads an `Authorization` header. `Authorization: Bearer` still appears all over the client —
but only ever aimed at `googleapis.com`, carrying Google's access token.

Consequence: cookie-authenticated state-changing endpoints need CSRF thought. `SameSite=Lax`
plus an `Origin` check on POST is the V1 answer, and development is same-origin through the
Vite proxy, so nothing is cross-site in either environment.

### 2.4 The Google access token lives in memory and nowhere else

Direct-to-Drive upload (TRD §2) requires the browser to hold a real Google access token. That
is not a compromise in this architecture, it *is* the mechanism. What follows from it:

* The token is held in a **module-scoped variable / React context value** — never in
  `localStorage`, `sessionStorage`, `IndexedDB`, or a cookie. A reload calls
  `POST /api/auth/refresh` and gets a new one: the session cookie survives the reload, so the
  access token does not have to.
* The backend **never persists the access token.** It is a passthrough value in the response
  body of `exchange` and `refresh`, and it is not logged (§2.8).
* `drive.file` is what bounds the blast radius (TRD §1): a leaked hour-long token reaches only
  files this application created.
* Refresh is **proactive**, scheduled at roughly 55 minutes, and also reactive on a `401` from
  Drive — a long upload must not die because the token aged out mid-file.

### 2.5 Resumable session URIs are the upload engine's real state — and they are credentials

TRD §7 offers `IndexedDB` or `localStorage`. Take **IndexedDB**, and treat the URI as a secret.

* A resumable session URI is a **pre-authorized write capability**: whoever holds it can PUT
  bytes into that user's Drive with no token at all. It is not a file id. It must never be
  logged, never appear in a URL, and never be sent to a Loom endpoint except the one in §2.7.
* `localStorage` is synchronous, string-only and around 5 MB. The queue holds a record per
  in-flight file (URI, confirmed offset, total size, name, `lastModified`, chosen HEIC
  strategy) and wants a keyed store with transactions. `localStorage` would work today and be
  wrong by Phase 4.
* **Session URIs expire after one week.** Records carry `createdAt` and are pruned when the
  queue loads, so a resume against a dead URI is prevented rather than handled.
* **A `File` handle does not survive a page reload.** This is the trap inside "resume after a
  page reload": the byte offset is durable, the `File` object is not. On reload the queue shows
  the entry as resumable and asks the user to re-select that file; the stored offset then makes
  the resume nearly free. Promising more than that is not implementable in a browser without
  the File System Access API, which Safari does not have — and Safari is the browser that
  matters most here, because these are iPhone photos.

### 2.6 Chunks are 8 MiB, and the client never trusts its own offset

`Blob.slice()` in multiples of 256 KiB (TRD §7), default **8 MiB** — inside the TRD's 5–10 MB
band and a clean 32 × 256 KiB. Note that "5 MB" as 5,000,000 bytes is *not* a multiple of
256 KiB, while the TRD's own byte range (`0 – 5,242,879`) is 5 MiB. **All chunk arithmetic is
in MiB**, and the chunk size is asserted `% 262144 === 0` at startup.

After every chunk, the authority on how much arrived is **Drive's `Range` response header**,
not the client's arithmetic. On a 5xx or a dropped connection the recovery is a zero-length PUT
with `Content-Range: bytes */<total>`, asking Drive where it got to, and resuming from there. A
client that resumes from its own counter will eventually write a corrupt file, and it will do
so silently.

The retry ladder is exponential backoff with jitter on `408`, `429` and `5xx`; `404` on a PUT
means the session is gone and the file restarts; a `4xx` other than those is permanent and
surfaces to the user. See §5.

### 2.7 The ephemeral transcode path is opt-in, streamed, and the only place media touches us

TRD §6's "Fast Cloud Processing" is the single exception to zero-knowledge storage, so it is
fenced in:

* **Off by default.** On-device WASM is the default (TRD §6); the cloud path is an explicit
  per-batch choice, made in the decision modal.
* **Streamed, never buffered.** `busboy` → `sharp` as a transform stream → `fetch` PUT into the
  resumable session URI, with backpressure preserved. No `multer`, no disk storage, no memory
  storage, no temp files — so, as in TRD §1, there is no cleanup path that can leak, because
  there is nothing to clean up.
* **A hard size cap**, enforced from `Content-Length` before the first byte is read: HEIC stills
  are single-digit megabytes, so a 32 MiB ceiling rejects abuse without rejecting real photos.
* **Nothing about the file enters a log** — not the name, not the size, not the Drive file id.
  See §2.8.
* This is the one path where a session URI reaches our backend: created by the client, used
  once, held only for the life of the request.

### 2.8 Logs are part of the privacy claim

"Servers never permanently store, log, or retain user media files" (TRD §1) is a statement
about `pino`, not only about disk. Concretely:

* No filename, Drive file id, folder id, byte size, MIME type, EXIF field or session URI in any
  log line, at any level, on any path — including error handlers and unhandled-rejection dumps.
* Request logging stays method / path / status / duration. `/api/media/transcode-stream` is a
  path and is fine; a query string carrying a filename would not be, so **filenames never go
  into URLs.**
* The error middleware logs `err`, and a failed `fetch` error can carry the request URL — which
  on the transcode path *is* a session URI. Errors crossing the Drive boundary are wrapped in a
  sanitized error before they reach the logger.
* Google's `sub` and the user's email are identity, not media. They are the one thing allowed.

This is a self-review item at the end of **every** phase, not a Phase 5 audit. A leak
introduced in Phase 2 and found in Phase 5 is a leak that shipped in every demo in between.

### 2.9 Live Photos: nothing in V1, but do not make V2 impossible

TRD §6 defers grouping, so V1 treats the `.HEIC` and its `.MOV` as unrelated files. The one
thing this plan asks of Phase 2: the upload queue keys records by a **stable per-file id** —
a hash of `name | size | lastModified` — rather than by array index, so V2's asset-UUID
grouping has something to attach to and so a queue reorder cannot corrupt a resume record.

### 2.10 Run TypeScript directly, and constrain it so that keeps working

Node 25 erases types; it does not transform them. Any syntax needing a runtime emit fails at
load: `enum`, parameter properties (`constructor(private x: T)`), `namespace`. `tsconfig.json`
sets `erasableSyntaxOnly: true` so `tsc --noEmit` catches those in a file nobody has run yet,
rather than Node throwing in production. Where an enum is wanted, use an `as const` object plus
a union type.

Relative imports carry the real extension — `import { loadConfig } from './config/config.ts'`
— which needs `allowImportingTsExtensions: true`. Get this wrong and every file fails to
resolve for a confusing reason.

---

## 3. Repository layout

Two halves, `backend/` and `web/`, as **npm workspaces** under a root `package.json`. The root
scripts are the single entry point for both, so nothing needs running from a subdirectory.
There is no Makefile: `npm run` is what a TypeScript project expects.

```
loom/
├── package.json          # workspaces: backend, web — root scripts are the entry point
├── docker-compose.yml    # MySQL 8 for local dev
├── CHANGELOG.md          # newest entry on top; every phase adds one
├── docs/                 # trd.md (the spec), plan.md (this), process.md (how we build)
├── agent-cache/          # gitignored working state: knowledge.md + plans/
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example      # copy to backend/.env
│   ├── db/
│   │   ├── schema.sql    # THE source of truth — hand-written, hand-run (§2.1)
│   │   └── changes/      # numbered incremental scripts
│   ├── prisma/
│   │   └── schema.prisma # GENERATED by `prisma db pull` — never hand-edit
│   ├── src/
│   │   ├── main.ts       # entry: config, server, shutdown
│   │   ├── config/       # env + .env loading, validation
│   │   ├── domain/       # types shared across layers — no I/O, no imports out
│   │   ├── api/          # express app, routers, middleware, request validation
│   │   ├── auth/         # google oauth exchange/refresh, sessions, token-crypto
│   │   ├── drive/        # google drive client: folder create, file get
│   │   ├── media/        # ephemeral heic transcode stream (§2.7)
│   │   └── store/        # prisma client, user repository
│   └── tests/
│       ├── unit/         # mirrors src/ — config/, auth/, api/ …
│       ├── integration/  # needs a live MySQL
│       └── e2e/          # black-box checks against a running stack
└── web/
    └── src/
        ├── auth/         # GIS code client, token lifecycle (§2.4)
        ├── upload/       # chunker, resumable engine, IndexedDB queue (§2.5)
        ├── heic/         # heic2any wrapper + strategy choice
        ├── drive/        # browser-side Drive reads for the gallery
        └── ui/           # screens per TRD §9
```

**All backend tests live under `backend/tests/`**, mirroring `src/`. TypeScript has no
in-package test requirement, and `node --test` takes a glob over the tree.

`domain` imports nothing from the other directories; everything else depends inward. Worth an
`import/no-restricted-paths` lint rule once there is code to enforce it against.

---

## 4. Data model

### 4.1 The one table

TRD §4's DDL, unchanged in shape, with §2.2's encryption applied to the value stored in
`refresh_token`:

| Column | Type | Note |
|---|---|---|
| `id` | `VARCHAR(255)` PK | Google profile `sub` — not an autoincrement, so no id of ours to leak |
| `email` | `VARCHAR(255)` UNIQUE | identity, and the only user-facing string we hold |
| `refresh_token` | `TEXT` | AES-256-GCM ciphertext, `v1:` prefixed (§2.2) |
| `app_folder_id` | `VARCHAR(255)` NULL | Drive folder id, filled on first exchange |
| `created_at` / `updated_at` | `DATETIME(3)` | Prisma-compatible defaults |

`utf8mb4` / `utf8mb4_unicode_ci`, InnoDB. An email is the natural login key, and it is unique
because Google's `sub` and email are 1:1 for a consumer account.

### 4.2 What is deliberately absent

No file table. No thumbnail cache. No upload history, no sizes, no filenames, no folder tree.
TRD §1's "Single Source of Truth" means Drive answers every one of those questions at read
time, and the database cannot leak what it never held. **Any future column describing a file is
a change to the architecture, not a schema tweak** — it goes through the TRD.

The absent table is also why there is no server-side upload queue: the queue is the client's
IndexedDB (§2.5), which is the only place it can be without us learning what people are
uploading.

---

## 5. Phase 2 in detail — the upload engine

The core of the product. Everything else is UI around it.

### 5.1 One file's state machine

```
QUEUED ──▶ INITIATING ──▶ UPLOADING ──▶ VERIFYING ──▶ DONE
             │  ▲            │  ▲           │
             │  └── retry ───┘  │           └── mismatch ──▶ FAILED
             │                  │
             └──▶ FAILED ◀──────┴── permanent 4xx / user cancel
                    │
                    └──▶ (network back / user retry) ──▶ PAUSED ──▶ UPLOADING
```

* `INITIATING` — `POST …/upload/drive/v3/files?uploadType=resumable`, metadata plus
  `parents: [appFolderId]`. Read the **`Location`** header; persist it with offset `0`.
* `UPLOADING` — `PUT` one 8 MiB slice with `Content-Range: bytes A-B/TOTAL`. `308` means
  continue, and its `Range` header is the new confirmed offset (§2.6). `200`/`201` means done.
* `VERIFYING` — `GET /drive/v3/files/<id>?fields=id,size`, size compared to the local size.
  This exists only to satisfy TRD §9's deletion guardrail: **the UI may not suggest deleting
  the local copy until this has passed.**
* `PAUSED` — an offline event, or the user. Resumes from the confirmed offset.

### 5.2 The retry ladder

| Response | Meaning | Action |
|---|---|---|
| `308` | chunk accepted | read `Range`, continue |
| `200` / `201` | file complete | verify |
| `429`, `5xx`, network error | transient | backoff `2^n * 1s` with jitter, cap 5 attempts, then query offset with `bytes */TOTAL` |
| `401` | access token expired mid-upload | refresh (§2.4), retry the same chunk |
| `404` on PUT | session gone or expired | drop the record, restart the file |
| other `4xx` | permanent | `FAILED`, message to the user, keep the record for inspection |
| `403` `storageQuotaExceeded` | user's Drive is full | `FAILED` with a specific message — this one is not a bug and must not read like one |

### 5.3 What is testable without a network

Most of it, and that is the point:

* **The chunker** — offsets and `Content-Range` strings for a 1-byte file, a file exactly one
  chunk long, one chunk plus a byte, and a 6 GB file. Pure arithmetic, so property-style cases
  are cheap and this is where an off-by-one would otherwise hide.
* **The state machine** — driven by a fake transport returning scripted responses: a `308`
  sequence, a `308` whose `Range` disagrees with the client's count, a `5xx` then a successful
  offset query, a `404`, a `401` then success, a size mismatch at verify.
* **The queue** — IndexedDB via `fake-indexeddb`: prune-on-load of week-old records, stable
  file ids under reordering (§2.9), and a resume record surviving a simulated reload.
* **Only the last mile needs Google**: one real multi-hundred-megabyte upload, once, plus one
  deliberately interrupted mid-file and resumed. That is a manual verification step, and
  Phase 2 is not done without it.

---

## 6. Phase-by-phase task breakdown

### Phase 0 — Scaffold

Root workspaces, `backend`/`web` packages, `tsconfig`, ESLint + Prettier · `docker-compose.yml`
with MySQL 8 · Prisma 7 client connecting via the mariadb adapter, `generate` succeeding with
zero models · Zod config from env and `.env` · pino logging · Express 5 with `GET /healthz`
reporting the database's real state · graceful shutdown · Vite React TS with a dev proxy and a
live health view · `npm run verify` as the gate every later phase runs.

**No schema, no Google, no OAuth.** Detailed as `agent-cache/plans/phase-0-scaffold.md`.

### Phase 1 — Auth and the Drive handshake

`backend/db/schema.sql` authored by hand (§4.1) and applied, then `prisma db pull` and
`generate` · startup table-existence check (§2.1) · `token-crypto.ts` (§2.2) with round-trip
and tamper-detection tests · `POST /api/auth/exchange`: code → Google tokens → upsert user →
create "Loom Backup" folder if `app_folder_id` is null → set session cookie → return the access
token · `POST /api/auth/refresh` · `GET /api/user/config` · `withSession` middleware (§2.3) ·
`helmet` arrives here, with real endpoints to protect · client: GIS code client, the landing
page, in-memory token with proactive refresh (§2.4).

**Verification:** sign in with a real Google account, see the folder appear in Drive, restart
the server and confirm the session survives, then confirm a second sign-in reuses the folder
rather than creating a second one.

### Phase 2 — Upload engine (see §5)

Chunker, resumable engine, IndexedDB queue, retry ladder, verify step, the queue UI from
TRD §9.4. Test-first throughout: the fake transport lands before the real one.

**Verification:** §5.3's unit suite, plus a real large upload and a real interrupted-and-resumed
upload.

### Phase 3 — HEIC pipeline

Client HEIC detection by extension **and** magic bytes · `heic2any` in a Web Worker so
conversion does not freeze the queue UI · the pre-upload decision modal (TRD §6) with
per-batch strategy · `POST /api/media/transcode-stream`: busboy → sharp → Drive, streamed,
capped, unlogged (§2.7) · the raw-upload path needs no code beyond skipping conversion.

**Verification:** all three paths produce a viewable file in Drive from the same source photo;
the server path shows flat memory under a large input; a log inspection for §2.8 compliance.

### Phase 4 — Gallery and session state

`GET files?q='<appFolderId>' in parents` from the browser with the access token · thumbnail
rendering (**see the `thumbnailLink` caveat in `agent-cache/knowledge.md` — verify this early,
it may force a different approach**) · `webViewLink` for full view · pagination · silent
refresh under a real 1-hour expiry.

### Phase 5 — Mobile hardening and privacy review

Upload recovery across a real network drop on a real phone · touch targets and viewport ·
the TRD §9 deletion guardrail verified as a *negative* test: no delete prompt appears until
`VERIFYING` passes · a full `pino` log audit against §2.8 · OAuth consent screen moved off
"Testing" (see the 7-day refresh-token expiry in `agent-cache/knowledge.md`) · `Secure` cookies
and an `Origin` check confirmed in a production-like config · **a reusable confirmation
dialog, first used on sign-out** (below).

#### A reusable confirmation dialog

Sign-out currently happens on a single click, and it is more destructive than it looks: it
drops the access token, and any upload in flight dies with it. That deserves an "are you
sure", and there will be others — cancelling a part-finished upload, clearing a queue,
eventually revoking access.

So it is built **once, generic**, not as a sign-out special case:

```ts
confirm({
  title: string
  body?: string
  confirmLabel: string        // names the action: "Sign out", not "OK"
  tone?: 'normal' | 'destructive'
}): Promise<boolean>
```

* A promise, so a caller reads as `if (await confirm({…})) …` rather than threading callbacks
  and open/close state through three components.
* One dialog element at the app root, driven by a small store — not one per caller.
* **The confirm button names the action** (`frontend-design`: an action keeps the same name
  through the whole flow). No "OK"/"Cancel" pairs.
* Escape and the backdrop cancel; focus moves into the dialog and returns to the trigger;
  `role="alertdialog"` with the title as its accessible name.
* Reuses the existing modal surface — the `#FFFFFF` panel with the leading ink rule — so it is
  a variant of a thing that exists rather than a second modal system.
* **It must say what is at stake when something is in flight.** "Sign out" with three uploads
  running should say so and count them, because the generic wording would be a lie about the
  consequence.

---

## 7. Mapping to TRD requirements

| TRD | Requirement | Where |
|---|---|---|
| §1 | Zero-knowledge media storage | §2.7 (streamed, no disk), §2.8 (logs), §4.2 (no file table) |
| §1 | Direct-to-Drive uploads | Phase 2 |
| §1 | Least privilege — `drive.file` only | Phase 1; §2.4 bounds the token |
| §1 | Drive as single source of truth | §4.2 |
| §4 | Schema isolated to identity | §4.1, and §2.2 hardens it |
| §5 | OAuth handshake, folder creation, silent refresh | Phase 1, §2.3, §2.4 |
| §6 | Three HEIC paths | Phase 3, §2.7 |
| §6 | Live Photos deferred | §2.9 |
| §7 | Resumable protocol, 256 KiB chunking, state persistence | §2.5, §2.6, §5 |
| §8 | Four endpoints | Phase 1 (three), Phase 3 (transcode) |
| §9 | Four screens | Phase 1, 2, 3, 4 |
| §9 | Deletion guidance guardrail | §5.1 `VERIFYING`, verified in Phase 5 |

---

## 8. Risks

**The `thumbnailLink` assumption (TRD §9.2).** Drive's `thumbnailLink` is short-lived and not a
plain public URL; dropping it into an `<img src>` may simply not render. If it fails, the
options are fetching thumbnails with the access token and using object URLs, or rendering
`iconLink` plus a name. This is a Phase 4 risk that is cheap to check in five minutes during
Phase 1 — do that rather than discovering it late.

**A "Testing" OAuth consent screen expires refresh tokens after seven days.** Every user is
silently signed out a week after consent, and it looks exactly like a bug in §2.2's encryption.
Know which state the consent screen is in before debugging any auth failure.

**iOS Safari and the file input.** Safari may transcode HEIC to JPEG on selection depending on
the `accept` attribute, which would make the HEIC pipeline appear to work while never actually
receiving HEIC; and a photo not yet downloaded from iCloud can yield a `File` that reads as
empty. Both need checking on a real device, not a simulator, and both belong in Phase 3.

**The Homebrew / nvm node conflict on this machine.** A fresh shell gets node 20.9.0, which
cannot run this project. See `agent-cache/knowledge.md`.

**Browser memory on multi-gigabyte video.** Nothing may ever call
`FileReader.readAsArrayBuffer` on a whole file. `Blob.slice()` per chunk is the only allowed
read path, and this is worth a lint-level rule of thumb rather than a code review each time.

---

## 9. After V1 — the standalone utilities

Specified in `docs/trd-utilities.md`: a **bulk HEIC → ZIP converter** and an **instant HEIC
viewer**. Both are zero-backend, unauthenticated, and run entirely in the browser's memory.

**Why they belong to this project rather than to another one.** Loom's whole claim is that it
does not touch your files. These tools are that claim with nothing else attached — no account,
no Drive, no request. They are also the only part of this project that is useful to somebody
who will never sign in, which makes them the honest front door rather than a marketing page.

**They are post-V1 and do not block it.** V1 ships when `docs/trd.md` is satisfied; these are
additive and share only the HEIC decoder.

| Phase | Deliverable | Rough size |
|---|---|---|
| 6 | Instant HEIC viewer — drop one file, see it, download it as JPEG | 1 d |
| 7 | Bulk HEIC → ZIP — batch convert, capped, progress, one archive | 1–2 d |

Phase 6 first because it is the smaller of the two and shares every piece Phase 7 needs: the
dropzone, the decode call, the object-URL lifecycle and the download link. Phase 7 then adds
only batching, the cap, and `jszip`.

**Three things decided up front**, because each is a defect waiting to be written:

1. **Reuse `web/src/heic/convert.ts`. Do not reintroduce `heic2any`.** Phase 3 established it
   calls `document.createElement`, so it cannot run in a Worker — survivable for a one-image
   viewer, fatal for a twenty-file batch that would freeze the tab for its whole run. The
   existing decoder tries `createImageBitmap` natively first and falls back to libheif WASM.
2. **`URL.revokeObjectURL` is not optional.** Every `createObjectURL` holds memory until it is
   revoked. Revoke in the effect cleanup and whenever an image is replaced. This is the single
   most likely defect in the viewer and it presents as "the tab got slow, then died".
3. **Cap a batch at 20 files or ~100 MB**, and process beyond that sequentially rather than
   refusing. Loom's own Phase 3 measured that decoding costs about three bytes per pixel
   regardless of how the bytes arrive, so a batch's peak is set by dimensions, not file size —
   and these tools are aimed at exactly the low-end devices where that ceiling is lowest.

**The audience inverts one of our assumptions.** Loom's HEIC path is fastest on iPhones, where
Safari decodes natively. These tools exist for Windows and Android, where it does not — so the
WASM fallback is the *hot* path here, not the cold one, and its ~2 MB download is on the
critical path for every real user of them.

---

## 10. Backup health

**Status:** accepted, V1 · **Decided:** 2026-09-22

A panel answering the one question the whole product exists for: *can I trust my backup?*

```
BACKUP HEALTH

Confirmed in Drive just now      12,482      84.1 GB
Interrupted, resumable                3       1.2 GB   expires in 4 days
Failed                                0
Uploaded by loom, all time       12,485      84.4 GB
Most recent file                      Today · 10:42
Folder                                Drive / loom      exists
```

### The one row that earns the panel

**Interrupted, resumable** is already in IndexedDB and is surfaced nowhere. A resumable session
dies after seven days, so *"three files are part-uploaded and you have four days to finish
them"* is real, actionable, and slightly alarming — which is the correct emotional register
for a backup tool.

### The schema change, and why it is a change

This adds **aggregate counters to `users`** — chosen over a per-file table, deliberately:

```sql
ALTER TABLE users
  ADD COLUMN files_uploaded BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN bytes_uploaded BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN last_backup_at DATETIME(3) NULL;
```

§4.2 says the database holds no file metadata, ever, and that a column describing a file is an
architecture change. **These columns describe no file.** They are quantities — how many, how
much, how recently. A stolen dump still reveals nothing about what anyone stored; it gains only
a usage profile. That is a real but much smaller disclosure, and it is the reason a per-file
table was rejected: a manifest would let Loom say *which* file is missing, and would put
filenames in the one place the architecture promises they never appear.

### What the counters buy that Drive cannot answer

This is the whole justification, and it is not "speed".

Drive can only tell you **what is there**. It cannot tell you something is **gone**, because a
deleted file leaves no trace to query. A monotonic count of what Loom has ever sent, compared
against what Drive currently holds, detects exactly that:

> Uploaded by loom, all time: 12,485 · Confirmed in Drive now: 12,482
> **3 files are no longer in the loom folder.**

Loom cannot say *which* — that would need the manifest we declined — but "something was removed"
is a true and useful thing to surface, and it costs no filenames. `files_uploaded` is therefore
**never decremented**.

### Three consequences to design for, not discover

1. **The server is not in the upload path, so the counters are client-reported.** Uploads go
   browser → Drive; nothing reaches us. A sixth endpoint, `POST /api/backup/record`, takes
   `{ files, bytes }` after a verified upload. It follows that **the counters are only as
   honest as the client** — fine for a personal tool, and it must not be described anywhere as
   an independent audit.
2. **They will drift, and reconciliation is the repair.** A browser that dies between Drive
   confirming and us recording loses the increment. So the panel **reconciles against Drive
   every time it loads**: Drive's live count is authoritative for "confirmed now", the counter
   is authoritative for "all time", and the gap between them is the signal rather than an
   error. Never show a counter as though it were a measurement.
3. **`BIGINT` activates the BigInt trap for the first time.** `agent-cache/knowledge.md`
   records that the mariadb adapter returns MySQL integers as JavaScript `BigInt`, and that
   `bigint-json.ts` serialises them **as strings** to stay lossless. Loom's one table has had
   no integer columns until now, so this is the first time that safety net carries load: the
   API will return `"bytesUploaded": "90194313216"`, and the client must `Number()` it. A
   frontend that assumes a number will silently concatenate.

### Sizing

Roughly a day. The schema change follows §2.1 — hand-written SQL applied by hand, then
`prisma db pull` — and the panel is assembly of data we already fetch, plus the queue state we
already persist.

