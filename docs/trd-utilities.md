# Technical Requirements Document: Standalone Utilities

**Companion to:** `docs/trd.md` (Loom itself), `docs/plan.md` §9 (how these are phased)
**Status:** accepted scope, post-V1 · **Date:** 2026-09-22

Two zero-backend, unauthenticated browser tools. Both operate entirely in the client's RAM, so
privacy is guaranteed by construction rather than by policy: there is no server to trust
because no request is made.

These sit **alongside** Loom, not inside it. They need no Google account, no Drive, no session
and no database, and that is the point — they are useful to someone who will never sign in,
and they are the honest front door to a product whose central claim is that it does not touch
your files.

---

## 1. Bulk HEIC → ZIP downloader

**Objective:** drag in multiple `.heic` files, convert to `.jpg` or `.png`, download one
`.zip`.

### Core technologies

| | |
|---|---|
| Decode | **`web/src/heic/convert.ts`** — `createImageBitmap` natively, falling back to `heic-decode` (libheif via WASM). **Not `heic2any`** — see §3 |
| Encode | `OffscreenCanvas.convertToBlob`, inside the existing worker |
| Archive | `jszip`, building the blob in memory |
| Download | `URL.createObjectURL` on a temporary `<a download>`, revoked after the click |

### Execution flow

1. **Ingest.** User drops an array of `File` objects into the dropzone.
2. **Convert.** Iterate, decode each HEIC, yield an `image/jpeg` (or `image/png`) Blob.
   *UI:* a batch progress indicator — "Converting 3 of 10".
3. **Archive.** `const zip = new JSZip()`, then `zip.file('name.jpg', blob)` per result.
4. **Download.** `zip.generateAsync({ type: 'blob' })`, `URL.createObjectURL`, a temporary
   `<a download>`, click, revoke.

### Constraints and guardrails

**Memory is the whole risk.** Decoding HEIC and holding several JPEGs plus a ZIP in memory at
once will crash a tab on a low-end device — which is precisely the device these users have.

* **Cap a batch at 20 files, or ~100 MB of input**, whichever comes first. Beyond that, process
  and download sequentially in batches rather than refusing.
* Release each source Blob as soon as its converted output exists; do not hold both for the
  whole run.
* `zip.generateAsync` with `streamFiles: true` where it helps, and never build a second copy of
  the archive to inspect it.

---

## 2. Instant HEIC viewer

**Objective:** a drag-and-drop pane so a Windows or Android user can *see* a `.heic` without
installing anything or creating an account.

### Core technologies

| | |
|---|---|
| Decode | **`web/src/heic/convert.ts`**, the same module. **Not `heic2any`** — see §3 |
| Render | a native `<img src>` fed by `URL.createObjectURL` |
| Download | the same object URL on an `<a download>` |

### Execution flow

1. **Ingest.** User drops a single `.heic`.
2. **Decode.** Show "Decoding…", convert to a JPEG Blob.
3. **Render.** `URL.createObjectURL(blob)` into an `<img src>`.
4. **Action bar.** "Download as JPG", reusing the same object URL on an `<a download>`.

### Constraints and guardrails

**Every `URL.createObjectURL` allocates memory that is never reclaimed until it is revoked.**
Call `URL.revokeObjectURL` in the effect's cleanup and whenever a new image replaces the old
one, or the tab eventually dies of it. This is the single most likely defect in this tool.

---

## 3. Two corrections to the brief, both learned the hard way

The brief names `heic2any` for both tools. Phase 3 of Loom established two things that change
that, and repeating the mistake would cost the same day twice:

**`heic2any` cannot run in a Web Worker.** It calls `document.createElement('canvas')`, and a
Worker has no `document`. For the *viewer* — one image, on the main thread — that is survivable.
For the *bulk converter* it is not: converting twenty files on the main thread freezes the tab
for the entire run, and a frozen tab during a progress bar is indistinguishable from a crash.

**Loom already has a decoder that works, and it is reusable as-is.** `web/src/heic/` decodes
with `createImageBitmap` first — **Safari and modern Chrome decode HEIC natively**, so most
visitors pay no WASM download at all — and falls back to `heic-decode` (libheif via WASM) only
where the browser refuses. It encodes with `OffscreenCanvas`, so it is worker-safe, and its
~2 MB fallback is already code-split into its own chunk.

**Requirement:** both utilities use `web/src/heic/convert.ts`. `heic2any` is not reintroduced.

One consequence worth stating: the native path means the *decode* result depends on the
browser, and the two tools are most valuable exactly where it is absent — Windows and Android.
So the WASM fallback is the hot path for the audience these tools are for, not the cold one.

---

## 4. What these deliberately are not

No accounts, no upload, no Drive, no analytics, no server round trip of any kind. If either
tool ever needs a backend, it has stopped being this tool.

No format conversion beyond HEIC → JPEG/PNG. No editing, cropping or metadata stripping — the
last is tempting and is a different product.
