# Loom — the frontend as built

**Companion to:** `docs/trd.md` (the spec), `docs/plan.md` (how it is phased),
`docs/process.md` (how we work)
**State:** Phases 0–4 complete · **Date:** 2026-09-21

A briefing on what exists in `web/` today, written so a design system can be mapped onto it
without anyone having to read 1,800 lines of TypeScript to find out what is load-bearing.

§7 is the important one: it lists the behaviour a redesign must not break, separated from the
appearance it is free to replace.

---

## 1. What Loom is

Someone's iPhone is full. Loom moves their photos into **their own Google Drive** and gives
them enough confidence to delete the originals.

That last clause is the product. Anyone can upload a file; the hard part is being trustworthy
enough that a person will delete the only other copy. Every architectural decision in this
project descends from it.

**The privacy model, which is unusual and is the reason the app exists:**

* Photos go **from the browser directly to Google Drive**. They do not pass through our server.
  Not a compression — the upload literally never touches us.
* The scope is **`drive.file` plus `openid email`**. Loom can see the files it created and
  nothing else in the user's Drive. Not their documents, not their other photos.
* The database holds **one table, `users`**, with an id, an email and an encrypted refresh
  token. There is no file table — no names, no sizes, no history. A database dump reveals who
  uses Loom and nothing about what they stored.
* **Nothing about a file is ever logged.** Not a filename, size, MIME type, Drive id or upload
  URL, on any path including error handlers.

There is exactly **one exception**, and it is opt-in per batch: the HEIC "convert on our
server" route streams a photo through the backend to convert it. It is never the default, it
is labelled as what it is, and nothing is written to disk or outlives the request.

**The tone that follows from this:** Loom is a utility, not a social product. It is closer to a
receipt than to a photo app. The user is not browsing for pleasure; they are checking.

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
```

The server has **five endpoints** and none of them store media:

| Endpoint | Does |
|---|---|
| `POST /api/auth/exchange` | Google code → tokens, creates the `loom` Drive folder, sets the session cookie |
| `POST /api/auth/refresh` | New access token from the stored refresh token |
| `POST /api/auth/signout` | Clears the session cookie |
| `GET /api/user/config` | The signed-in user's email and folder id |
| `POST /api/media/transcode-stream` | The opt-in HEIC route. Converts and PUTs to Drive; keeps nothing |

Two tokens, and the distinction matters when reading the code:

* **The Google access token** lives in a module variable in the browser and nowhere else —
  never `localStorage`, never a cookie. It expires hourly. Every `Authorization: Bearer` in
  the frontend points at `googleapis.com`, never at us.
* **The Loom session** is a signed, `httpOnly` cookie. The frontend cannot read it, by design.

---

## 3. The file map

```
web/src/
├── App.tsx                 signed out → landing; signed in → Shell
├── main.tsx
│
├── auth/
│   ├── token.ts            the access token, in memory only; collapsed refresh
│   ├── gis.ts              Google Identity Services popup → auth code
│   └── useSession.ts       loading | signed-out | signed-in, + 55-min refresh timer
│
├── upload/                 the engine — the largest and most intricate part
│   ├── chunk.ts            chunk arithmetic and the two Content-Range formats
│   ├── identity.ts         stable per-file id (SHA-256 of name|size|lastModified)
│   ├── transport.ts        the only code that touches a Drive upload session URI
│   ├── db.ts               IndexedDB queue records, pruned after 7 days
│   ├── queue.ts    (584 l) the state machine, retry ladder, and four upload routes
│   └── useQueue.ts         useSyncExternalStore bindings — ids, per-item, summary
│
├── heic/
│   ├── detect.ts           magic bytes, not the filename
│   ├── strategy.ts         the three routes as a union
│   ├── convert.ts          worker lifecycle
│   └── convert.worker.ts   createImageBitmap, falling back to libheif WASM
│
├── drive/
│   ├── list.ts             files.list with paging and 401-refresh-retry
│   └── useGallery.ts       accumulated pages, refresh, loadMore
│
└── ui/
    ├── tokens.css          the palette and type scale
    ├── App.css     (417 l) every component style
    ├── Shell.tsx           header, Photos/Uploads switch
    ├── Gallery.tsx         the contact sheet + hero sentence
    ├── Tile.tsx            one frame, memoised
    ├── QueueScreen.tsx     file picker, HEIC detection, the queue list
    ├── QueueRow.tsx        one file's progress and controls
    └── DecisionModal.tsx   the three HEIC routes
```

---

## 4. Screens and states

### Landing (signed out)

Wordmark, one-line pitch, three plain assurances, one button. The assurances are the reason
anyone would grant a backup tool access to their Drive, so they are stated as facts about
behaviour rather than as badges.

### Shell (signed in)

Header with a **Photos / Uploads** switch and sign-out. Two views:

**Photos — the contact sheet.** A sentence stating how many photos are safe, then a dense grid
of square framed thumbnails, newest first, paging as you scroll. A tile opens the file in
Drive. A file with no thumbnail yet renders as a named frame rather than a broken image.

**Uploads — the queue.** A file picker, per-file rows with progress, and controls. Each row is
in one of eight states:

| State | Means |
|---|---|
| `QUEUED` | waiting its turn (one file uploads at a time) |
| `CONVERTING` | HEIC → JPEG in a worker |
| `INITIATING` | opening a resumable session with Drive |
| `UPLOADING` | sending 8 MiB chunks |
| `PAUSED` | user paused, or offline |
| `VERIFYING` | asking Drive to confirm the stored size |
| `DONE` | finished **and** size-confirmed |
| `FAILED` | with a message |
| `NEEDS_FILE` | resumable after a reload, but the browser lost the file handle |

### Decision modal

Appears only when a batch contains a **real** HEIC, by magic bytes. Three routes, on-device
preselected. The cloud option's copy says plainly that the photo passes through our server,
because that is the one place TRD §1's claim is qualified.

---

## 5. How state is managed

There is **no global store, and no state library**, deliberately. Three different mechanisms,
each chosen for its problem:

**1. React state** for things that change when a person does something — which view is open,
whether the modal is up, the session status.

**2. An external store with per-item subscriptions** for the upload queue. `createQueue()` owns
its own state and exposes `subscribe(id, fn)`; components read through `useSyncExternalStore`.
A chunk landing on file 7 re-renders row 7 and nothing else. Progress is throttled to four
updates per second per file, and the header watches a derived summary — counts and booleans —
rather than the item map.

This is not premature optimisation. Hundreds of files × an event per 8 MiB is thousands of
updates; in a single `useState` at the list level, every row re-renders on every one, and a
working engine looks broken.

**3. Module variables** for the access token and the learned OAuth `redirect_uri`. Deliberately
outside React, because they are not UI state and must not be serialised into one.

---

## 6. The design language, as it stands

Chosen for a reason worth keeping or arguing with rather than inheriting silently.

**The reference is a photographic contact sheet** — the artefact whose entire purpose is
checking what you have. That is Loom's job. So the screen is dense and utilitarian, not airy
and carded, and the grid is evidence for a sentence rather than the main event.

```
--paper      #EDEEF0   cool fibre-paper grey. NOT cream: warm grounds cast photographs
--paper-lift #F6F7F8   raised surfaces
--ink        #16181D   near-black, blue cast
--graphite   #5A6070   secondary text
--frame      #C9CDD4   hairline borders — the only structural device
--verified   #1F6F4A   the single accent; means "safely in Drive" and nothing else
--alert      #9B2C2C   failures only
```

**Type:** Archivo, 400/500/700, one family. Tabular figures on every count — an alignment
requirement, which is why it is solved with figures rather than a second typeface.

**Four rules currently in force:**

1. Hairline frames are the only structural device. **No shadows, no border-radius, no cards.**
2. One accent, and it is semantic. Green never decorates.
3. Density over air.
4. Motion only in response to an action. Nothing fades in because it loaded.

**Known weak points** — fair game for a new schema:

* The queue row is the least designed surface in the app; its controls are `0.2rem 0.55rem`
  and too small for a phone.
* There is no dark mode. `color-scheme: light` is declared.
* `App.css` is 417 lines in one file with no component scoping.
* The landing page is plainer than it probably deserves to be.

---

## 7. What a redesign must not break

The line between **behaviour** and **appearance**. Everything in §6 is appearance. The
following is behaviour, and each item is load-bearing for a reason:

| Constraint | Why |
|---|---|
| **No "delete your local copy" affordance until `verified` is true** | TRD §9. Gated on Drive confirming the stored size, never on the progress bar reaching 100%. This is the promise the whole product rests on |
| **The queue must stay mounted across navigation** | It is currently hidden, not unmounted. Unmounting destroys the engine and any upload in flight |
| **Never cache or persist a `thumbnailLink`** | Those URLs expire. A cached one fails silently, which looks like data loss |
| **The gallery re-reads on open** | That is what picks up a finished upload and refreshes expiring thumbnails |
| **Progress must not re-render the list** | Per-item subscriptions and throttling. Breaking this makes the engine look broken while it works perfectly |
| **The access token stays in memory** | Never `localStorage`, `sessionStorage`, IndexedDB or a cookie |
| **On-device conversion stays the default** | The cloud route is the one exception to the privacy claim and must always be a deliberate choice |
| **The cloud route's label must say the file passes through our server** | It is the one place TRD §1 is qualified; softening the copy makes the claim dishonest |
| **A missing thumbnail degrades to a named frame** | Drive has no thumbnail for a `.mov` until it makes one |
| **Nothing about a file reaches a log** | Applies to `console` in the browser too |

---

## 8. What is not built

No deleting from Loom — TRD scopes deletion to *guidance*, never an action. No search, albums,
sorting or favourites. No Live Photo grouping: a `.HEIC` and its `.MOV` are unrelated files in
V1. No dark mode. No offline shell or service worker. No settings screen — there is nothing to
configure. No sharing.

**Still outstanding at the time of writing:** the one-hour silent-refresh check, and everything
in Phase 5 — the real-device pass, the deletion guardrail as a negative test, the full log
audit, and a production-like cookie config.
