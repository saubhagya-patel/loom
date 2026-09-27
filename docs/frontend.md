# Loom — the frontend as built

**Companion to:** `docs/trd.md` (the spec), `docs/trd-utilities.md` (the standalone tools),
`docs/plan.md` (how it is phased), `docs/process.md` (how we work)
**State:** Phases 0–4 complete · Phase 5 in progress · the standalone tools built
**Date:** 2026-09-26 · ~3,960 lines in `web/src`

A briefing on what exists in `web/` today, written so a design system can be mapped onto it
without anyone having to read four thousand lines of TypeScript to find out what is
load-bearing.

**§7 is the one to read before redesigning.** It lists the behaviour a new UI must not break,
separated from the appearance it is free to replace entirely.

---

## 1. What Loom is

Someone's iPhone is full. Loom moves their photos into **their own Google Drive** and gives
them enough confidence to delete the originals.

That last clause is the product. Anyone can upload a file; the hard part is being trustworthy
enough that a person will delete the only other copy. Every architectural decision descends
from it, and so should every design one: **this is closer to a receipt than to a photo app.**
The user is not browsing for pleasure, they are checking.

**The privacy model, which is unusual and is the reason the app exists:**

* Photos go **from the browser directly to Google Drive**. Not compressed through us — the
  upload literally never touches our server.
* The scope is **`drive.file` plus `openid email`**. Loom sees the files it created and nothing
  else in the user's Drive.
* The database holds **one table, `users`** — an id, an email, an encrypted refresh token.
  There is no file table. A stolen dump reveals who uses Loom and nothing about what they
  stored.
* **Nothing about a file is ever logged.** Not a filename, size, MIME type, Drive id or upload
  URL, on any path including error handlers. Audited end to end in Phase 5: zero leaks across
  32 log lines and 16 route exercises.

There is exactly **one exception**, opt-in per batch: the HEIC "convert on our server" route
streams a photo through the backend. Never the default, always labelled as what it is, nothing
written to disk or outliving the request.

---

## 2. Architecture, in one page

```
  Browser                                    Our server              Google
  ───────                                    ──────────              ──────
  sign in  ──── auth code ──────────────────▶ exchange ────────────▶ tokens
           ◀─── access token + session cookie ─┘

  upload   ═══ file bytes, in 8 MiB chunks ═════════════════════════▶ Drive
           (never touches our server)

  gallery  ─── files.list with the access token ────────────────────▶ Drive

  HEIC, cloud route only (opt-in):
           ─── photo ───▶ convert, streamed ───▶ Drive

  /tools/* ─── nothing. no request of any kind leaves the page.
```

Five endpoints, none of which store media:

| Endpoint | Does |
|---|---|
| `POST /api/auth/exchange` | Google code → tokens, creates the `loom` Drive folder, sets the session cookie |
| `POST /api/auth/refresh` | New access token from the stored refresh token |
| `POST /api/auth/signout` | Clears the session cookie |
| `GET /api/user/config` | The signed-in user's email and folder id |
| `POST /api/media/transcode-stream` | The opt-in HEIC route. Converts and PUTs to Drive; keeps nothing |

**Two tokens, and the distinction matters when reading the code.** The *Google access token*
lives in a module variable in the browser and nowhere else; it expires hourly, and every
`Authorization: Bearer` in the frontend points at `googleapis.com`, never at us. The *Loom
session* is a signed `httpOnly` cookie the frontend cannot read, by design.

---

## 3. Routes

`react-router`, with **every route lazily loaded**. That is not a nicety — see §7.

| Route | Auth | Renders |
|---|---|---|
| `/` | signed out → landing, signed in → Shell | the product |
| `/tools/heic-viewer` | **none** | drop one HEIC, see it, download as JPEG |
| `/tools/heic-to-zip` | **none** | drop many, convert, download one zip |
| `*` | none | not found |

The tool routes are specified in `docs/trd-utilities.md`. They exist for someone on Windows or
Android who will never sign in, they make **zero network requests**, and they are the only part
of Loom that demonstrates the privacy claim instead of asserting it. Both are reachable from
the landing page as a real offer, and from the signed-in shell as a quiet footer line.

---

## 4. The file map

```
web/src/                                          ~3,960 lines
├── main.tsx                 38   the router; every route lazy
├── App.tsx                  69   landing (signed out) / Shell (signed in)
│
├── auth/
│   ├── token.ts             39   the access token, in memory only; collapsed refresh
│   ├── gis.ts               71   Google Identity Services popup → auth code
│   └── useSession.ts       102   loading | signed-out | signed-in, + 55-min refresh timer
│
├── upload/                       the engine — the largest and most intricate part
│   ├── chunk.ts             38   chunk arithmetic; the two Content-Range forms differ
│   ├── identity.ts          21   stable per-file id (SHA-256 of name|size|lastModified)
│   ├── transport.ts        143   the only code that touches a Drive upload session URI
│   ├── db.ts                74   IndexedDB queue records, pruned after 7 days
│   ├── queue.ts            608   state machine, retry ladder, four upload routes
│   └── useQueue.ts          29   useSyncExternalStore bindings — ids, per-item, summary
│
├── heic/
│   ├── detect.ts            55   magic bytes, never the filename
│   ├── strategy.ts          42   the three routes as a union
│   ├── convert.ts           64   worker lifecycle; DEFAULT_QUALITY = 0.91
│   └── convert.worker.ts    61   createImageBitmap first, libheif WASM as fallback
│
├── drive/
│   ├── list.ts              95   files.list, paging, 401-refresh-retry
│   └── useGallery.ts        85   accumulated pages, refresh, loadMore, lastLoadedAt
│
├── tools/                        zero-request, unauthenticated
│   ├── ToolShell.tsx        57   shared chrome + the standing privacy line
│   ├── Dropzone.tsx         67   shared drag target
│   ├── useObjectUrl.ts      20   revocation only — see §7
│   ├── HeicViewer.tsx       74
│   ├── HeicToZip.tsx       149   batching, the cap, jszip (lazily imported)
│   └── NotFound.tsx         15
│
└── ui/
    ├── tokens.css          117   palette, type, the two structural rules
    ├── App.css             990   every component style, one file
    ├── format.ts            57   bytes, rate, kindOf, dayLabel — the mechanical register
    ├── Emblem.tsx           10   the mark
    ├── Shell.tsx            75   masthead, Photos/Uploads switch
    ├── Gallery.tsx         160   hero, day-grouped volumes, density toggle
    ├── Tile.tsx             83   one frame; memoised; 429 backoff
    ├── QueueScreen.tsx     196   ingest target, telemetry strip, HEIC detection
    ├── QueueRow.tsx        131   one file: asset / status / controls
    ├── DecisionModal.tsx    72   the three HEIC routes
    └── ToolLinks.tsx        39   the way into /tools from both sides of sign-in
```

Dependencies, all of them: `react`, `react-dom`, `react-router`, `idb`, `heic-decode`, `jszip`.
No state library, no UI kit, no CSS framework.

---

## 5. Screens and states

### Landing (signed out)

Emblem and wordmark, a one-line pitch, three assurances stated as facts about behaviour rather
than badges, one button. Below a hairline, a real offer of the free tools for someone not
ready to hand over a Google account.

### Shell (signed in)

Masthead: emblem, wordmark, a `Drive direct` chip, a **Photos / Uploads** segmented control
with a live in-flight count, the standing "Scoped to Drive/loom only" line, the email, sign
out.

**Photos — the contact sheet.** A hero sentence counting what is safely in Drive, a density
toggle, then day-grouped *volumes* — each a header band with the date and "N items verified",
followed by a grid of hairline frames with a white matte and the photograph inset. Paging is
driven by an `IntersectionObserver`, not a button. Format badges come from the MIME type Drive
reports. A file with no thumbnail degrades to a named plate.

**Uploads — the transfer log.** A dashed ingest target with drag-and-drop, a telemetry strip
of counts, then rows in three columns: *asset* (kind badge, name, size), *status* (state chip,
`Chunk 4 of 6 · 8 MiB each · 68%`, a 2px rail, bytes and transfer rate), *controls*.

Each row is in one of nine states:

| State | Means |
|---|---|
| `QUEUED` | waiting its turn — one file uploads at a time |
| `CONVERTING` | HEIC → JPEG in a worker |
| `INITIATING` | opening a resumable session with Drive |
| `UPLOADING` | sending 8 MiB chunks |
| `PAUSED` | user paused, or offline |
| `VERIFYING` | asking Drive to confirm the stored size |
| `DONE` | finished **and** size-confirmed |
| `FAILED` | with a message |
| `NEEDS_FILE` | resumable after a reload, but the browser lost the file handle |

### Decision modal

Shown only when a batch contains a **real** HEIC, by magic bytes. Three routes, on-device
preselected, the cloud option carrying a "Leaves device" tag. When every `.heic` turns out to
be a JPEG the modal does not appear and a line explains why — silence there reads as a bug,
and on iOS it is the normal case.

### The tools

Shared shell, shared dropzone, the standing privacy line. Viewer: decode, show, download.
Converter: a JPEG/PNG toggle, batch progress, one zip per 20 files or 100 MB.

---

## 6. How state is managed

**No global store and no state library**, deliberately. Four mechanisms, each for its problem:

1. **React state** for what changes when a person acts — the open view, the modal, session
   status.
2. **An external store with per-item subscriptions** for the upload queue. `createQueue()` owns
   its state and exposes `subscribe(id, fn)`; components read through `useSyncExternalStore`, so
   a chunk landing on file 7 re-renders row 7 and nothing else. Progress is throttled to four
   updates per second per file; the header watches a derived summary of counts and booleans,
   never the item map. **Not premature optimisation** — hundreds of files × an event per 8 MiB
   is thousands of updates, and one `useState` at the list level re-renders every row on every
   one, which makes a working engine look broken.
3. **Module variables** for the access token and the learned OAuth `redirect_uri` — not UI
   state, and must never be serialised into it.
4. **IndexedDB** for the upload queue's durable half: session URI, confirmed offset, identity
   hash. Pruned at 7 days because Drive's sessions expire then.

---

## 7. What a redesign must not break

Everything in §8 is appearance and can be replaced wholesale. **This is behaviour.** Each line
cost something to learn.

| Constraint | Why |
|---|---|
| **No "delete your local copy" affordance until `verified` is true** | TRD §9. Gated on Drive confirming the stored size, never on the rail reaching 100%. This is the promise the product rests on |
| **The queue stays mounted across navigation** | Currently hidden, not unmounted. Unmounting destroys the engine and every upload in flight |
| **The gallery is remounted on open** | That is what picks up a finished upload and refreshes expiring thumbnail URLs |
| **Never cache or persist a `thumbnailLink`** | They expire. A cached one fails silently, which looks like data loss |
| **A failed thumbnail backs off and retries, then degrades** | `lh3.googleusercontent.com` returns **429** under a grid's burst — measured. Never leave the browser's alt text on screen |
| **Progress must not re-render the list** | Per-item subscriptions and throttling, per §6 |
| **The access token stays in memory** | Never `localStorage`, `sessionStorage`, IndexedDB or a cookie |
| **On-device conversion stays the default** | The cloud route is the one exception to the privacy claim and must always be a deliberate choice |
| **The cloud route's label says the file passes through our server** | Softening that copy makes TRD §1 dishonest |
| **A missing thumbnail degrades to a named plate** | Drive has no thumbnail for a `.mov` until it makes one |
| **Tool routes must not import the app** | They are lazy for a reason: an Android visitor viewing one photo must not download the auth stack, upload engine and Drive client. Verified by grepping the built chunks |
| **Tool routes must not touch auth** | Signed-out is the *expected* visitor there, not an error state |
| **Every `createObjectURL` is revoked** | `useObjectUrl` owns revocation; the URL is created in the handler that made the blob. Leaking these is the named most-likely defect in the viewer |
| **Nothing about a file reaches a log** | Including `console` in the browser |

**Two things that look like decoration and are not**: the emerald is *only* verification, and
the terracotta is *only* the control that commits something. If a redesign spends either
colour elsewhere, both stop meaning anything.

**One thing that looked like information and was not**, removed on purpose: a verified tick on
every contact-sheet frame. The gallery *is* a listing of Drive, so the mark was true of every
tile and therefore said nothing. The claim is made once per day-group instead. Do not add it
back per-frame.

---

## 8. The design language, as it stands

From `design/` (gitignored), a Stitch export named *minimal cloud vault*. Two systems ship in
that folder; the screens use the **warm ceramic** palette with the loom typography — that is
what the inline styles actually render, and the Tailwind config in the export is overridden and
is not the source of truth.

The reference is a photographic contact sheet and a precision instrument: hairline framing,
mechanical labels, no pillowy cards or diffuse shadows. Depth comes from tonal stacking.

```
--canvas     #FBF7F4   unglazed ceramic; the app ground
--raised     #FAF6F2   masthead
--surface    #FFFFFF   lifted panels, the matte inside a frame
--recessed   #F3ECE5   inset wells, segmented controls, progress tracks
--bone       #FAF3DD   warm tint, used sparingly
--ink        #2B303A   primary text
--muted      #5E6472   metadata
--faint      #8C93A1   tertiary
--hairline   #EED2CC   rose-ceramic; does nearly all the framing work
--clay       #A1683A   terracotta; ONLY the control that commits something
--verified   #245F50   means "confirmed in your Drive" and nothing else
--alert      #A52A2A
```

**Type: two families with distinct jobs.** *Hanken Grotesk* (400/500/600) carries language —
headlines at 40/46 with -0.03em tracking, body at 14. *Space Mono* carries anything mechanical:
counts, sizes, states, paths, chunk positions. Uppercase mono at 10px/0.06em is the engraved
label, used the way a camera body is marked. Tabular figures on every count.

**Radii:** 4px on controls, cells and badges; 8px on sheets and modals. Nothing is pill-shaped
except status dots.

**Four rules in force:**

1. Hairlines and tonal stacking do the structural work. No heavy shadows, nothing floating.
2. Terracotta commits; emerald verifies. Neither ever decorates.
3. Language in the grotesque, mechanics in the mono. A number never sets in the sans.
4. Motion answers an action. Nothing animates because it loaded.

**JPEG quality is 0.91**, in the browser and on the server. Measured on a real 287 KB HEIC:
0.88 → 534 KB, 0.91 → 605 KB, 1.0 → 1314 KB. Quality 1.0 is *not* lossless — it is minimal
quantisation of an already-lossy HEIC, preserving artifacts we did not create at 2.5x the
bytes. Genuinely lossless exists twice and neither is JPEG: raw HEIC upload keeps the original
bytes, PNG in the converter is mathematically lossless.

**Not taken from the mock**, because it shows data Loom does not have or must not display:

* **The resumable session id** in a transfer row — a bearer credential (`plan.md` §2.5).
* **EXIF and camera model** — never read, and §2.8 forbids holding it.
* **Invented telemetry** — archive protocol versions, a SQLite cache, LIBRAW, allocated
  terabytes, batch numbers, `Matched sha256`. Printing fictional provenance in a product whose
  proposition is trustworthiness is the one lie that would matter.
* **RAW/DNG badges** → derived from the MIME type Drive actually reports.
* **The avatar photo** → we request `openid email`, not `profile`; no picture exists.
* **"Manual Ingest" / "Target Directory"** → "Add photos". No directory targeting exists.

**Known weak points, fair game for a new pass:** no dark mode; `App.css` is 990 lines in one
file with no component scoping; the landing page is the least developed screen; `QueueRow`'s
controls are small for a phone; there is no confirmation before sign-out, which kills uploads
in flight.

---

## 9. Changes already made, and why they should stay

A redesign will meet each of these and may reasonably want to undo one. Each was a decision
with a reason, and several cost a debugging session to reach.

### Removed: the verified tick on every frame

Every contact-sheet tile carried a green circle-check labelled "Verified in Drive". **It said
nothing.** The gallery *is* a listing of Drive, so the mark was true of every tile without
exception — decoration wearing a status badge. It also broke the system's own rule that emerald
means verification and nothing else, and the principle that structural devices encode
information rather than ornament it.

The claim is now made **once per day-group** in the volume header ("6 items verified"), where
it is readable and where the count actually varies. The tick that *does* carry information is
the one in the upload queue, where `verified` gates TRD §9's deletion guardrail — that one is
load-bearing and stays.

### Changed: `heic2any` → `heic-decode` + `OffscreenCanvas`

TRD §6 names `heic2any`. It calls `document.createElement('canvas')` four times, so it throws
in a Web Worker — and the worker is the point, because converting a batch on the main thread
freezes the queue UI for the whole run. Replaced with libheif via WASM, encoding through
`OffscreenCanvas`. `createImageBitmap` is tried first so Safari uses its own decoder and an
iPhone never downloads the 2 MB fallback.

### Changed: thumbnails retry instead of showing alt text

`lh3.googleusercontent.com` rate-limits: four rapid requests measured `200, 200, 200, 429`. A
dense grid asks for dozens at once and trips it routinely, and the symptom was intermittent
broken frames. Now a failed frame backs off **with jitter** — retrying in lockstep reproduces
the burst — remounts the `<img>` twice, then degrades to a named plate. Requesting `=s320`,
not `=s480`: the frame is 190px.

### Changed: JPEG quality 0.88 → 0.91

Browser and server both. See §8 for the measurements and why 1.0 is the wrong answer rather
than the maximum one.

### Changed: the transfer rate moved into the engine

It was computed during render from a clock and a ref — both impure, both flagged. It is a
property of the transfer, not of the view, so `queue.ts` measures it and puts
`bytesPerSecond` on the item.

### Changed: `useObjectUrl` owns revocation only

The URL is created in the handler that made the blob. Creating it inside an effect means
setting state from that effect; creating it during render is a side effect in a pure function.
Revocation is the half that leaks, so that is the half the hook owns.

### Removed: the Vite scaffold stylesheet

`web/src/index.css` shipped ~110 lines of purple accent, drop shadows, `color-scheme: light
dark` and an 18px root font, silently fighting every token added later. Deleted rather than
overridden — overrides are where specificity fights start.

### Added: a router, with every route lazy

`react-router` rather than a hand-rolled `pathname` switch, because the switch would be
smaller today and wrong by the fourth route. Real cost measured: **~30 kB gzipped**, against a
2 MB WASM chunk. Laziness is not optional — see §7.

### Added: the substitution note outside the modal

When every `.heic` in a batch turns out to already be JPEG, the decision modal correctly does
not appear — and the explanation used to live *inside* that modal, so the user saw nothing and
read it as broken. On iOS that silence is the normal case, since Safari can substitute a whole
batch at selection time.

### Kept deliberately: the queue is hidden, not unmounted

Switching to Photos must not destroy the engine or the uploads in flight. The gallery is the
opposite — remounted on open, so it re-reads Drive.

---

## 10. What is not built

No deleting from Loom — TRD scopes deletion to *guidance*, never an action. No search, albums,
sorting or favourites. No Live Photo grouping: a `.HEIC` and its `.MOV` are unrelated files in
V1. No dark mode. No offline shell or service worker. No settings screen. No sharing.

**Planned and specified, not yet built:**

* **Backup health** (`plan.md` §10) — a panel answering "can I trust my backup?", on aggregate
  counters added to `users`. Its best row is *interrupted, resumable* — uploads that are part
  done with a session expiring in N days, currently surfaced nowhere.
* **A reusable confirmation dialog** (`plan.md` §6, Phase 5) — promise-returning, generic, and
  required to state what is in flight when something is.
* **Phase 5's remaining verification** — the real-device pass, the deletion guardrail as a
  negative test, and the OAuth consent-screen decision.
